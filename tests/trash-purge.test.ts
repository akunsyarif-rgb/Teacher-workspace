import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

// Hapus permanen dari Sampah di atas Admin DB palsu (BUKAN Firestore sungguhan): membuktikan logika izin,
// cakupan cascade, urutan anak->induk, batas batch, pembatalan saat penyimpanan gagal, dan dapat diulang.
const fake = createFakeAdminDb();
const verifyIdToken = vi.fn();
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__TS__' } }));
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminDb: () => fake.db,
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminBucket: () => ({ file: () => ({ delete: async () => undefined }) }),
}));

import { purgeAllServer, purgeItemServer } from '../lib/server/trashPurgeService';
import { ApiError } from '../lib/server/apiErrors';
import { POST as purgeRoute } from '../app/api/trash/purge/route';

const db = () => fake.db as never;
const deleted = { deletedAt: { seconds: 1 }, deletedBy: 'owner1' };
const files = {
  deleteSubmissionFiles: vi.fn(async (paths: string[]) => paths.length),
  deleteMaterialFile: vi.fn(async (_p: string) => true),
};
const opts = (extra = {}) => ({ files, ...extra });
const has = (path: string) => path in fake.store;
const prefixCount = (prefix: string) => Object.keys(fake.store).filter((k) => k.startsWith(prefix)).length;

function seedStudentData(ws: string, id: string, extra: { code?: string } = {}) {
  fake.store[`grades/${id}_c1`] = { workspaceId: ws, studentId: id, columnId: 'c1', score: '80' };
  fake.store[`grades/${id}_c2`] = { workspaceId: ws, studentId: id, columnId: 'c2', score: '70' };
  fake.store[`submissions/a1_${id}`] = {
    workspaceId: ws, assignmentId: 'a1', studentId: id,
    attachments: [{ fileUrl: `supabase-storage://submission-attachments/submissions/${ws}/a1/u-${id}/x_${id}.png`, fileName: 'foto.png', filePath: `submissions/${ws}/a1/u-${id}/x_${id}.png` }],
  };
  fake.store[`student_achievements/ach_${id}`] = { workspaceId: ws, studentId: id, title: 'Juara' };
  fake.store[`student_notes/note_${id}`] = { workspaceId: ws, studentId: id, title: 'Konseling' };
  fake.store[`student_profiles/uid_${id}`] = { workspaceId: ws, studentId: id, className: '7A' };
  fake.store[`student_login_codes/${extra.code ?? `CODE${id}`}`] = { workspaceId: ws, studentId: id, className: '7A' };
}

function seedStudent(ws: string, id: string, className: string, extra: Record<string, unknown> = {}) {
  fake.store[`students/${id}`] = { workspaceId: ws, className, name: id, accessCode: `CODE${id}`, ...extra };
  seedStudentData(ws, id);
}

beforeEach(() => {
  fake.reset();
  files.deleteSubmissionFiles.mockClear().mockImplementation(async (paths: string[]) => paths.length);
  files.deleteMaterialFile.mockClear().mockResolvedValue(true);
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'owner1' });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake.store['teacher_profiles/owner1'] = { workspaceId: 'w1', role: 'OWNER' };
  fake.store['teacher_profiles/admin1'] = { workspaceId: 'w1', role: 'ADMIN' };
  fake.store['teacher_profiles/guru1'] = { workspaceId: 'w1', role: 'TEACHER' };
  fake.store['teacher_profiles/owner2'] = { workspaceId: 'w2', role: 'OWNER' };
});

describe('izin: hanya OWNER/ADMIN', () => {
  beforeEach(() => {
    seedStudent('w1', 's1', '7A', deleted);
    fake.store['assignments/a1'] = { workspaceId: 'w1', title: 'T', className: '7A', ...deleted };
    fake.store['grade_columns/c1'] = { workspaceId: 'w1', title: 'K', className: '7A', ...deleted };
  });

  it('guru biasa DITOLAK 403 untuk semua jenis dan untuk kosongkan Sampah; tidak ada yang terhapus', async () => {
    const before = JSON.stringify(fake.store);
    for (const target of [{ kind: 'student', id: 's1' }, { kind: 'assignment', id: 'a1' }, { kind: 'column', id: 'c1' }, { kind: 'class', id: '7A' }] as const) {
      await expect(purgeItemServer('guru1', target, db(), opts())).rejects.toMatchObject({ status: 403 });
    }
    await expect(purgeAllServer('guru1', db(), opts())).rejects.toMatchObject({ status: 403 });
    expect(JSON.stringify(fake.store)).toBe(before);
    expect(files.deleteSubmissionFiles).not.toHaveBeenCalled();
  });

  it('akun tanpa workspace / tanpa profil ditolak 403', async () => {
    fake.store['teacher_profiles/kosong'] = { role: 'OWNER' };
    await expect(purgeItemServer('kosong', { kind: 'student', id: 's1' }, db(), opts())).rejects.toMatchObject({ status: 403 });
    await expect(purgeItemServer('hantu', { kind: 'student', id: 's1' }, db(), opts())).rejects.toMatchObject({ status: 403 });
  });

  it('OWNER dan ADMIN boleh', async () => {
    await expect(purgeItemServer('admin1', { kind: 'column', id: 'c1' }, db(), opts())).resolves.toMatchObject({ done: true });
    await expect(purgeItemServer('owner1', { kind: 'assignment', id: 'a1' }, db(), opts())).resolves.toMatchObject({ done: true });
  });

  it('OWNER workspace LAIN tidak bisa menghapus item workspace ini (diperlakukan tidak ada: 404)', async () => {
    await expect(purgeItemServer('owner2', { kind: 'student', id: 's1' }, db(), opts())).rejects.toMatchObject({ status: 404 });
    expect(has('students/s1')).toBe(true);
  });
});

describe('hanya item yang SUDAH di Sampah', () => {
  it('item aktif ditolak 409 dan tidak tersentuh; id tak dikenal 404; id kosong 400', async () => {
    seedStudent('w1', 'aktif', '7A'); // tidak terhapus
    await expect(purgeItemServer('owner1', { kind: 'student', id: 'aktif' }, db(), opts())).rejects.toMatchObject({ status: 409 });
    await expect(purgeItemServer('owner1', { kind: 'student', id: 'nope' }, db(), opts())).rejects.toMatchObject({ status: 404 });
    await expect(purgeItemServer('owner1', { kind: 'student', id: '  ' }, db(), opts())).rejects.toMatchObject({ status: 400 });
    expect(has('students/aktif')).toBe(true);
    expect(prefixCount('grades/')).toBe(2);
  });

  it('deletedAt = null (sudah dipulihkan) dianggap aktif', async () => {
    seedStudent('w1', 'pulih', '7A', { deletedAt: null });
    await expect(purgeItemServer('owner1', { kind: 'student', id: 'pulih' }, db(), opts())).rejects.toMatchObject({ status: 409 });
  });
});

describe('hapus siswa (cascade)', () => {
  beforeEach(() => {
    seedStudent('w1', 's1', '7A', deleted);
    seedStudent('w1', 's2', '7A'); // siswa aktif: tidak boleh tersentuh
    seedStudent('w2', 'x1', '7A', deleted); // tenant lain
  });

  it('menghapus siswa + kode akses + sesi login + nilai + pengumpulan + prestasi + catatan; yang lain utuh', async () => {
    const res = await purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts());
    expect(res.done).toBe(true);
    expect(res.counts).toMatchObject({ students: 1, grades: 2, submissions: 1, achievements: 1, notes: 1, profiles: 1, files: 1 });
    for (const p of ['students/s1', 'grades/s1_c1', 'grades/s1_c2', 'submissions/a1_s1', 'student_achievements/ach_s1', 'student_notes/note_s1', 'student_profiles/uid_s1', 'student_login_codes/CODEs1']) {
      expect(has(p), p).toBe(false);
    }
    // siswa aktif dan tenant lain TIDAK tersentuh
    for (const p of ['students/s2', 'grades/s2_c1', 'submissions/a1_s2', 'student_profiles/uid_s2', 'student_login_codes/CODEs2', 'students/x1', 'grades/x1_c1', 'student_login_codes/CODEx1']) {
      expect(has(p), p).toBe(true);
    }
  });

  it('lampiran fisik dihapus hanya untuk path milik workspace ini (path asing/tidak valid diabaikan)', async () => {
    fake.store['submissions/a1_s1'].attachments.push(
      { fileUrl: 'supabase-storage://submission-attachments/submissions/w2/a1/u/curang.png', filePath: 'submissions/w2/a1/u/curang.png' }, // workspace lain
      { fileUrl: 'supabase-storage://submission-attachments/submissions/w1/../w2/a/u/x', filePath: 'submissions/w1/../w2/a/u/x' }, // traversal
    );
    await purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts());
    expect(files.deleteSubmissionFiles).toHaveBeenCalledTimes(1);
    expect(files.deleteSubmissionFiles.mock.calls[0][0]).toEqual(['submissions/w1/a1/u-s1/x_s1.png']);
  });

  it('URUTAN: semua data anak dihapus SEBELUM dokumen siswa (aman bila terputus)', async () => {
    await purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts());
    const order = fake.writes.filter((w) => w.op === 'delete').map((w) => w.path);
    const parentIdx = order.indexOf('students/s1');
    expect(parentIdx).toBeGreaterThan(-1);
    for (const child of ['grades/s1_c1', 'submissions/a1_s1', 'student_profiles/uid_s1', 'student_notes/note_s1']) {
      expect(order.indexOf(child), child).toBeLessThan(parentIdx);
    }
  });

  it('batas batch: 1.300 nilai satu siswa dihapus dalam batch <= 450 operasi', async () => {
    for (let i = 0; i < 1300; i++) fake.store[`grades/s1_x${i}`] = { workspaceId: 'w1', studentId: 's1', columnId: `x${i}`, score: '1' };
    const res = await purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts());
    expect(res.counts.grades).toBe(1302);
    expect(Math.max(...fake.hooks.batchSizes)).toBeLessThanOrEqual(450);
    expect(prefixCount('grades/s1_')).toBe(0);
  });

  it('penyimpanan lampiran GAGAL: dibatalkan sebelum dokumen apa pun yang menyimpan path dihapus; ulang berhasil', async () => {
    files.deleteSubmissionFiles.mockRejectedValueOnce(new ApiError('Lampiran siswa belum bisa dihapus dari penyimpanan.', 502));
    await expect(purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts())).rejects.toMatchObject({ status: 502 });
    expect(has('submissions/a1_s1')).toBe(true); // path-nya masih tersimpan -> berkas tidak yatim
    expect(has('students/s1')).toBe(true); // masih tampil di Sampah untuk diulang
    await expect(purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts())).resolves.toMatchObject({ done: true });
    expect(has('students/s1')).toBe(false);
  });

  it('terputus di tengah (commit gagal): induk masih ada; mengulang menuntaskan tanpa duplikat/hilang', async () => {
    fake.hooks.failCommitNumber = 3; // gagal pada batch ke-3 (mis. setelah sebagian anak terhapus)
    await expect(purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts())).rejects.toThrow();
    expect(has('students/s1')).toBe(true);
    fake.hooks.failCommitNumber = 0;
    const res = await purgeItemServer('owner1', { kind: 'student', id: 's1' }, db(), opts());
    expect(res.done).toBe(true);
    expect(has('students/s1')).toBe(false);
    expect(prefixCount('grades/s1_')).toBe(0);
    expect(has('students/s2')).toBe(true);
  });
});

describe('hapus tugas dan kolom nilai', () => {
  beforeEach(() => {
    fake.store['assignments/a1'] = { workspaceId: 'w1', title: 'T', className: '7A', gradeColumnId: 'c1', materialFilePath: 'assignment-materials/w1/a1/u/soal.pdf', ...deleted };
    fake.store['assignments/a2'] = { workspaceId: 'w1', title: 'Aktif', className: '7A' };
    fake.store['grade_columns/c1'] = { workspaceId: 'w1', title: 'K', className: '7A' }; // kolom aktif milik tugas itu
    for (const sid of ['s1', 's2']) {
      fake.store[`submissions/a1_${sid}`] = { workspaceId: 'w1', assignmentId: 'a1', studentId: sid, attachments: [{ fileUrl: `supabase-storage://submission-attachments/submissions/w1/a1/u/${sid}.png`, filePath: `submissions/w1/a1/u/${sid}.png` }] };
      fake.store[`grades/${sid}_c1`] = { workspaceId: 'w1', studentId: sid, columnId: 'c1', score: '90' };
    }
    fake.store['submissions/a2_s1'] = { workspaceId: 'w1', assignmentId: 'a2', studentId: 's1' };
  });

  it('tugas: pengumpulan + lampiran + materi ikut terhapus; tugas lain dan kolom nilainya utuh', async () => {
    const res = await purgeItemServer('owner1', { kind: 'assignment', id: 'a1' }, db(), opts());
    expect(res.counts).toMatchObject({ assignments: 1, submissions: 2, files: 3 }); // 2 lampiran + 1 materi
    expect(files.deleteMaterialFile).toHaveBeenCalledWith('assignment-materials/w1/a1/u/soal.pdf');
    expect(has('assignments/a1')).toBe(false);
    expect(prefixCount('submissions/a1_')).toBe(0);
    expect(has('assignments/a2')).toBe(true);
    expect(has('submissions/a2_s1')).toBe(true);
    expect(has('grade_columns/c1')).toBe(true); // item terpisah
    expect(has('grades/s1_c1')).toBe(true);
  });

  it('materi di luar awalan workspace tidak dihapus', async () => {
    fake.store['assignments/a1'].materialFilePath = 'assignment-materials/w2/a9/u/milik-lain.pdf';
    await purgeItemServer('owner1', { kind: 'assignment', id: 'a1' }, db(), opts());
    expect(files.deleteMaterialFile).not.toHaveBeenCalled();
  });

  it('kolom nilai: seluruh nilai di kolom itu ikut terhapus; kolom lain utuh', async () => {
    fake.store['grade_columns/c1'] = { workspaceId: 'w1', title: 'K', className: '7A', ...deleted };
    fake.store['grade_columns/c2'] = { workspaceId: 'w1', title: 'K2', className: '7A' };
    fake.store['grades/s1_c2'] = { workspaceId: 'w1', studentId: 's1', columnId: 'c2', score: '55' };
    const res = await purgeItemServer('owner1', { kind: 'column', id: 'c1' }, db(), opts());
    expect(res.counts).toMatchObject({ columns: 1, grades: 2 });
    expect(has('grade_columns/c1')).toBe(false);
    expect(has('grades/s1_c1') || has('grades/s2_c1')).toBe(false);
    expect(has('grade_columns/c2')).toBe(true);
    expect(has('grades/s1_c2')).toBe(true);
  });
});

describe('hapus kelas', () => {
  it('hanya siswa yang terhapus bersama kelas (deletedBatchId); siswa terhapus satuan dan kelas lain utuh', async () => {
    for (const id of ['k1', 'k2', 'k3']) seedStudent('w1', id, '8C', { ...deleted, deletedBatchId: 'b1' });
    seedStudent('w1', 'satuan', '8C', deleted); // terhapus satu per satu: item sendiri
    seedStudent('w1', 'lain', '8D', { ...deleted, deletedBatchId: 'b2' });
    const res = await purgeItemServer('owner1', { kind: 'class', id: '8C' }, db(), opts());
    expect(res).toMatchObject({ done: true, counts: { students: 3, grades: 6, submissions: 3 } });
    expect(prefixCount('students/k')).toBe(0);
    expect(has('students/satuan')).toBe(true);
    expect(has('students/lain')).toBe(true);
  });

  it('kelas tidak ada di Sampah -> 404', async () => {
    seedStudent('w1', 'a', '8C'); // aktif
    await expect(purgeItemServer('owner1', { kind: 'class', id: '8C' }, db(), opts())).rejects.toMatchObject({ status: 404 });
  });

  it('kelas besar (70 siswa) diproses per 30 siswa; anggaran waktu habis -> done:false lalu dilanjutkan sampai tuntas', async () => {
    for (let i = 0; i < 70; i++) seedStudent('w1', `b${i}`, '9Z', { ...deleted, deletedBatchId: 'b' });
    let t = 0;
    const now = () => (t += 1000);
    const first = await purgeItemServer('owner1', { kind: 'class', id: '9Z' }, db(), opts({ now, timeBudgetMs: 1500 }));
    expect(first.done).toBe(false);
    expect(first.counts.students).toBeGreaterThan(0);
    expect(first.counts.students).toBeLessThan(70);
    let guard = 0;
    let total = first.counts.students;
    let last = first;
    while (!last.done && guard++ < 10) {
      last = await purgeItemServer('owner1', { kind: 'class', id: '9Z' }, db(), opts({ now, timeBudgetMs: 1500 }));
      total += last.counts.students;
    }
    expect(last.done).toBe(true);
    expect(total).toBe(70);
    expect(prefixCount('students/b')).toBe(0);
  });
});

describe('kosongkan Sampah', () => {
  it('menghapus semua item terhapus di workspace; yang aktif dan tenant lain utuh', async () => {
    seedStudent('w1', 'd1', '7A', deleted);
    seedStudent('w1', 'd2', '8C', { ...deleted, deletedBatchId: 'b' });
    seedStudent('w1', 'aktif', '7A');
    fake.store['assignments/ad'] = { workspaceId: 'w1', title: 'x', className: '7A', ...deleted };
    fake.store['assignments/aa'] = { workspaceId: 'w1', title: 'y', className: '7A' };
    fake.store['grade_columns/cd'] = { workspaceId: 'w1', title: 'k', className: '7A', ...deleted };
    fake.store['grades/d1_cd'] = { workspaceId: 'w1', studentId: 'd1', columnId: 'cd', score: '1' };
    seedStudent('w2', 'asing', '7A', deleted);
    fake.store['assignments/asing'] = { workspaceId: 'w2', title: 'z', className: '7A', ...deleted };

    const res = await purgeAllServer('admin1', db(), opts());
    expect(res.done).toBe(true);
    expect(res.counts).toMatchObject({ students: 2, assignments: 1, columns: 1 });
    for (const p of ['students/d1', 'students/d2', 'assignments/ad', 'grade_columns/cd']) expect(has(p), p).toBe(false);
    for (const p of ['students/aktif', 'assignments/aa', 'students/asing', 'assignments/asing', 'grades/asing_c1']) expect(has(p), p).toBe(true);
  });

  it('Sampah kosong -> done:true, tanpa penghapusan', async () => {
    seedStudent('w1', 'aktif', '7A');
    const res = await purgeAllServer('owner1', db(), opts());
    expect(res).toMatchObject({ done: true, counts: { students: 0, assignments: 0, columns: 0 } });
    expect(has('students/aktif')).toBe(true);
  });
});

describe('POST /api/trash/purge', () => {
  const req = (body: unknown, token: string | null = 'tok') =>
    new NextRequest('http://localhost/api/trash/purge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    fake.store['grade_columns/c1'] = { workspaceId: 'w1', title: 'K', className: '7A', ...deleted };
    fake.store['grades/s1_c1'] = { workspaceId: 'w1', studentId: 's1', columnId: 'c1', score: '1' };
  });

  it('401 tanpa token; sesi dicabut diperiksa', async () => {
    expect((await purgeRoute(req({ all: true }, null))).status).toBe(401);
    await purgeRoute(req({ kind: 'column', id: 'c1' }));
    expect(verifyIdToken).toHaveBeenCalledWith('tok', true);
  });

  it('guru biasa 403 dengan pesan aman; admin 200', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'guru1' });
    const denied = await purgeRoute(req({ kind: 'column', id: 'c1' }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatch(/pemilik atau admin/);
    expect(has('grade_columns/c1')).toBe(true);
    verifyIdToken.mockResolvedValue({ uid: 'admin1' });
    const ok = await purgeRoute(req({ kind: 'column', id: 'c1' }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ done: true, counts: { columns: 1, grades: 1 } });
  });

  it('body tidak valid -> 400 (jenis asing, id kosong, all bukan true, tanpa body)', async () => {
    for (const body of [{ kind: 'workspace', id: 'w1' }, { kind: 'student', id: '' }, { all: false }, {}]) {
      expect((await purgeRoute(req(body))).status).toBe(400);
    }
    expect(has('grade_columns/c1')).toBe(true);
  });

  it('galat tak terduga -> 500 generik tanpa detail internal', async () => {
    fake.hooks.failCommitNumber = 1;
    const res = await purgeRoute(req({ kind: 'column', id: 'c1' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/DEADLINE|simulasi/);
  });
});
