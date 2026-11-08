import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDeletedStudents = vi.fn();
const getDeletedAssignments = vi.fn();
const getDeletedColumns = vi.fn();
const restoreStudent = vi.fn(async (_id: string) => true);
const restoreClassOnServer = vi.fn(async (_c: string) => 3);
const restoreAssignment = vi.fn(async (_id: string) => true);
const restoreColumn = vi.fn(async (_id: string) => true);
vi.mock('../lib/repositories/studentRepository', () => ({
  getDeletedStudents: (...a: unknown[]) => getDeletedStudents(...a),
  restoreStudent: (id: string) => restoreStudent(id),
  restoreClassOnServer: (c: string) => restoreClassOnServer(c),
}));
vi.mock('../lib/repositories/assignmentRepository', () => ({
  getDeletedAssignments: (...a: unknown[]) => getDeletedAssignments(...a),
  restoreAssignment: (id: string) => restoreAssignment(id),
}));
vi.mock('../lib/repositories/gradeColumnRepository', () => ({
  getDeletedColumns: (...a: unknown[]) => getDeletedColumns(...a),
  restoreColumn: (id: string) => restoreColumn(id),
}));
const purgeOnServer = vi.fn();
vi.mock('../lib/repositories/trashRepository', () => ({ purgeOnServer: (b: unknown) => purgeOnServer(b) }));
const clearAllCached = vi.fn();
vi.mock('../lib/utils/sessionCache', () => ({ clearAllCached: () => clearAllCached() }));

import { buildRecycleBin, canPurge, canRestoreItem, describePurgeScope, emptyBin, loadRecycleBin, purgeBinItem, restoreBinItem } from '../lib/services/recycleBinService';
import { restoreItem, purgeItem, emptyBin as emptyBinController } from '../lib/controllers/recycleBinController';

const ts = (sec: number) => ({ seconds: sec });
const student = (id: string, o: Record<string, unknown> = {}) => ({ id, workspaceId: 'w1', name: id, className: '7A', createdBy: 'guru1', deletedAt: ts(100), deletedBy: 'guru1', ...o });
const assignment = (id: string, o: Record<string, unknown> = {}) => ({ id, workspaceId: 'w1', title: `T-${id}`, className: '7A', createdBy: 'guru1', deletedAt: ts(200), ...o });
const column = (id: string, o: Record<string, unknown> = {}) => ({ id, workspaceId: 'w1', title: `K-${id}`, className: '7B', createdBy: 'guru1', deletedAt: ts(300), ...o });

const GURU = { uid: 'guru1', role: 'TEACHER' };
const OTHER = { uid: 'guru2', role: 'TEACHER' };
const OWNER = { uid: 'owner1', role: 'OWNER' };

beforeEach(() => {
  purgeOnServer.mockReset();
  [getDeletedStudents, getDeletedAssignments, getDeletedColumns, restoreStudent, restoreClassOnServer, restoreAssignment, restoreColumn, clearAllCached].forEach((m) => m.mockClear());
});

describe('canRestoreItem — sama dengan aturan server/rules', () => {
  it('OWNER/ADMIN boleh semua, termasuk kelas dan item tanpa createdBy', () => {
    for (const role of ['OWNER', 'ADMIN']) {
      for (const kind of ['class', 'student', 'assignment', 'column'] as const) {
        expect(canRestoreItem({ kind, createdBy: null }, { uid: 'x', role })).toBe(true);
      }
    }
  });
  it('guru biasa: hanya item buatannya sendiri; tidak pernah kelas; tidak item lama tanpa createdBy', () => {
    expect(canRestoreItem({ kind: 'student', createdBy: 'guru1' }, GURU)).toBe(true);
    expect(canRestoreItem({ kind: 'student', createdBy: 'guru1' }, OTHER)).toBe(false);
    expect(canRestoreItem({ kind: 'assignment', createdBy: null }, GURU)).toBe(false);
    expect(canRestoreItem({ kind: 'class', createdBy: 'guru1' }, GURU)).toBe(false);
    expect(canRestoreItem({ kind: 'column', createdBy: 'guru1' }, { uid: 'guru1', role: null })).toBe(true);
  });
});

describe('buildRecycleBin', () => {
  const raw = {
    students: [
      student('s1'),
      student('s2', { deletedAt: ts(500) }),
      // siswa yang terhapus bersama kelasnya (hapus kelas) -> dikelompokkan jadi satu entri kelas
      student('k1', { className: '8C', deletedBatchId: 'b1', createdBy: 'orang', deletedAt: ts(400), deletedBy: 'owner1' }),
      student('k2', { className: '8C', deletedBatchId: 'b1', createdBy: 'orang', deletedAt: ts(450), deletedBy: 'owner1' }),
      student('k3', { className: '8C', deletedBatchId: 'b1', createdBy: 'orang', deletedAt: ts(420), deletedBy: 'owner1' }),
    ],
    assignments: [assignment('a1'), assignment('a2', { createdBy: 'guru2' })],
    columns: [column('c1'), column('c2', { createdBy: undefined })],
  } as never;

  it('OWNER: melihat semuanya; kelas dikelompokkan (1 entri, 3 siswa), siswa kelas tidak muncul sendiri-sendiri', () => {
    const bin = buildRecycleBin(raw, OWNER);
    expect(bin.classes).toHaveLength(1);
    expect(bin.classes[0]).toMatchObject({ kind: 'class', id: '8C', title: 'Kelas 8C', count: 3, detail: '3 siswa', deletedAt: 450_000, deletedBy: 'owner1' });
    expect(bin.students.map((s) => s.id)).toEqual(['s2', 's1']); // tidak ada k1..k3
    expect(bin.assignments).toHaveLength(2);
    expect(bin.columns).toHaveLength(2);
    expect(bin.total).toBe(1 + 2 + 2 + 2);
  });

  it('guru biasa: hanya yang bisa ia pulihkan; tidak melihat kelas terhapus, sampah guru lain, atau item lama tanpa createdBy', () => {
    const bin = buildRecycleBin(raw, GURU);
    expect(bin.classes).toEqual([]);
    expect(bin.students.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(bin.assignments.map((a) => a.id)).toEqual(['a1']); // a2 milik guru2
    expect(bin.columns.map((c) => c.id)).toEqual(['c1']); // c2 tanpa createdBy
    expect(bin.total).toBe(4);
    expect(buildRecycleBin(raw, OTHER).assignments.map((a) => a.id)).toEqual(['a2']);
  });

  it('diurutkan terbaru di atas; tanggal tidak diketahui paling bawah; label konteks benar', () => {
    const bin = buildRecycleBin(
      { students: [student('a', { deletedAt: ts(1) }), student('b', { deletedAt: ts(9) }), student('c', { deletedAt: undefined })], assignments: [], columns: [] } as never,
      OWNER
    );
    expect(bin.students.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(bin.students[2].deletedAt).toBeNull();
    expect(buildRecycleBin(raw, OWNER).columns[0].detail).toBe('Kolom nilai · Kelas 7B');
    expect(buildRecycleBin(raw, OWNER).assignments[0].detail).toBe('Tugas · Kelas 7A');
  });

  it('Timestamp Firestore (toMillis) maupun {seconds} dibaca benar', () => {
    const bin = buildRecycleBin({ students: [student('t', { deletedAt: { toMillis: () => 777 } })], assignments: [], columns: [] } as never, OWNER);
    expect(bin.students[0].deletedAt).toBe(777);
  });

  it('kosong -> total 0', () => {
    expect(buildRecycleBin({ students: [], assignments: [], columns: [] }, OWNER)).toEqual({ classes: [], students: [], assignments: [], columns: [], total: 0 });
  });
});

describe('loadRecycleBin', () => {
  it('mengambil tiga sumber secara paralel untuk workspace yang benar; tanpa workspace -> kosong tanpa query', async () => {
    getDeletedStudents.mockResolvedValue([student('s1')]);
    getDeletedAssignments.mockResolvedValue([assignment('a1')]);
    getDeletedColumns.mockResolvedValue([column('c1')]);
    const bin = await loadRecycleBin('w1', GURU);
    expect(getDeletedStudents).toHaveBeenCalledWith('w1');
    expect(getDeletedAssignments).toHaveBeenCalledWith('w1');
    expect(getDeletedColumns).toHaveBeenCalledWith('w1');
    expect(bin.total).toBe(3);
    getDeletedStudents.mockClear();
    expect((await loadRecycleBin('', GURU)).total).toBe(0);
    expect(getDeletedStudents).not.toHaveBeenCalled();
  });
});

describe('restoreBinItem / restoreItem', () => {
  it('tiap jenis memanggil pemulihan yang benar (siswa & kelas lewat server)', async () => {
    await restoreBinItem({ kind: 'student', id: 's1', className: '7A' }, GURU);
    await restoreBinItem({ kind: 'assignment', id: 'a1', className: '7A' }, GURU);
    await restoreBinItem({ kind: 'column', id: 'c1', className: '7A' }, GURU);
    await restoreBinItem({ kind: 'class', id: '8C', className: '8C' }, OWNER);
    expect(restoreStudent).toHaveBeenCalledWith('s1');
    expect(restoreAssignment).toHaveBeenCalledWith('a1');
    expect(restoreColumn).toHaveBeenCalledWith('c1');
    expect(restoreClassOnServer).toHaveBeenCalledWith('8C');
  });

  it('guru biasa tidak bisa memulihkan kelas (pesan jelas, tidak memanggil server)', async () => {
    await expect(restoreBinItem({ kind: 'class', id: '8C', className: '8C' }, GURU)).rejects.toThrow(/pemilik atau admin/);
    expect(restoreClassOnServer).not.toHaveBeenCalled();
  });

  it('controller: sukses mengosongkan cache; permission-denied Firestore jadi pesan ramah; pesan server dipertahankan', async () => {
    const item = { key: 'k', kind: 'assignment', id: 'a1', title: 'T', detail: '', className: '7A', deletedAt: 1, deletedBy: null, createdBy: 'guru2' } as const;
    await restoreItem(item, GURU);
    expect(clearAllCached).toHaveBeenCalledTimes(1);

    restoreAssignment.mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    const denied = await restoreItem(item, GURU).catch((e) => e);
    expect(denied.message).toMatch(/tidak punya izin/);
    expect(denied.message).not.toMatch(/Missing or insufficient/);

    restoreStudent.mockRejectedValueOnce(new Error('Paket Anda dibatasi maksimal 3 kelas.'));
    const limit = await restoreItem({ ...item, kind: 'student' }, GURU).catch((e) => e);
    expect(limit.message).toBe('Paket Anda dibatasi maksimal 3 kelas.');
    expect(clearAllCached).toHaveBeenCalledTimes(1); // gagal -> cache tidak dikosongkan
  });
});

// ---------- Hapus permanen ----------
const zero = { students: 0, assignments: 0, columns: 0, grades: 0, submissions: 0, achievements: 0, notes: 0, profiles: 0, loginCodes: 0, files: 0 };
const part = (o: Partial<typeof zero>) => ({ ...zero, ...o });
const ADMIN = { uid: 'admin1', role: 'ADMIN' };

describe('hapus permanen — izin di sisi klien', () => {
  it('canPurge: hanya OWNER/ADMIN', () => {
    expect(canPurge(OWNER)).toBe(true);
    expect(canPurge(ADMIN)).toBe(true);
    expect(canPurge(GURU)).toBe(false);
    expect(canPurge({ uid: 'x', role: null })).toBe(false);
  });

  it('guru biasa: purge item dan kosongkan Sampah ditolak TANPA memanggil server', async () => {
    await expect(purgeBinItem({ kind: 'student', id: 's1', className: '7A' }, GURU)).rejects.toThrow(/pemilik atau admin/);
    await expect(emptyBin(GURU)).rejects.toThrow(/pemilik atau admin/);
    await expect(purgeItem({ key: 'k', kind: 'student', id: 's1', title: 'x', detail: '', className: '7A', deletedAt: 1, deletedBy: null, createdBy: 'guru1' }, GURU)).rejects.toThrow();
    await expect(emptyBinController(GURU)).rejects.toThrow();
    expect(purgeOnServer).not.toHaveBeenCalled();
    expect(clearAllCached).not.toHaveBeenCalled();
  });
});

describe('hapus permanen — OWNER/ADMIN', () => {
  it('mengirim jenis + id; untuk kelas id = NAMA kelas', async () => {
    purgeOnServer.mockResolvedValue({ done: true, counts: part({ students: 1 }) });
    await purgeBinItem({ kind: 'student', id: 's1', className: '7A' }, OWNER);
    await purgeBinItem({ kind: 'class', id: '8C', className: '8C' }, ADMIN);
    expect(purgeOnServer.mock.calls.map((c) => c[0])).toEqual([{ kind: 'student', id: 's1' }, { kind: 'class', id: '8C' }]);
  });

  it('server melapor done:false -> dipanggil ulang sampai tuntas; jumlah dijumlahkan', async () => {
    purgeOnServer
      .mockResolvedValueOnce({ done: false, counts: part({ students: 30, grades: 60 }) })
      .mockResolvedValueOnce({ done: false, counts: part({ students: 30, grades: 60 }) })
      .mockResolvedValueOnce({ done: true, counts: part({ students: 10, grades: 20 }) });
    const res = await purgeBinItem({ kind: 'class', id: '9Z', className: '9Z' }, OWNER);
    expect(purgeOnServer).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ rounds: 3, counts: { students: 70, grades: 140 } });
  });

  it('tidak berputar tanpa akhir: berhenti dengan pesan yang bisa ditindaklanjuti', async () => {
    purgeOnServer.mockResolvedValue({ done: false, counts: part({}) });
    await expect(emptyBin(OWNER)).rejects.toThrow(/belum selesai.*aman diulang/);
    expect(purgeOnServer).toHaveBeenCalledTimes(30);
  });

  it('kosongkan Sampah mengirim {all:true}; controller mengosongkan cache setelah sukses', async () => {
    purgeOnServer.mockResolvedValue({ done: true, counts: part({ students: 2, assignments: 1 }) });
    const res = await emptyBinController(OWNER);
    expect(purgeOnServer).toHaveBeenCalledWith({ all: true });
    expect(res.counts).toMatchObject({ students: 2, assignments: 1 });
    expect(clearAllCached).toHaveBeenCalledTimes(1);
  });

  it('galat server (mis. lampiran gagal dihapus) diteruskan apa adanya dan cache tidak dikosongkan', async () => {
    purgeOnServer.mockRejectedValue(new Error('Lampiran siswa belum bisa dihapus dari penyimpanan.'));
    await expect(purgeItem({ key: 'k', kind: 'student', id: 's1', title: 'x', detail: '', className: '7A', deletedAt: 1, deletedBy: null, createdBy: 'u' }, OWNER)).rejects.toThrow(/Lampiran siswa/);
    expect(clearAllCached).not.toHaveBeenCalled();
  });
});

describe('describePurgeScope (isi dialog konfirmasi)', () => {
  it('menyebut apa yang ikut terhapus dan apa yang TIDAK, per jenis', () => {
    expect(describePurgeScope({ kind: 'student' })).toMatch(/kode akses.*nilai.*pengumpulan.*lampiran.*catatan wali kelas.*SELAMANYA.*rekap presensi/);
    expect(describePurgeScope({ kind: 'assignment' })).toMatch(/pengumpulan siswa.*SELAMANYA.*Kolom nilai.*tidak ikut/);
    expect(describePurgeScope({ kind: 'column' })).toMatch(/seluruh nilai.*SELAMANYA/);
    expect(describePurgeScope({ kind: 'class', count: 3 })).toMatch(/^3 siswa.*SELAMANYA.*Jurnal, presensi, dan jadwal kelas tidak ikut/);
  });
});
