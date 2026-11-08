import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

// Rename kelas: tiap batch atomik, job dapat dilanjutkan & idempoten, satu rename per
// workspace, batas 500 operasi dihormati. Admin DB palsu (BUKAN Firestore sungguhan):
// membuktikan LOGIKA kita; atomisitas tiap batch di Firestore adalah jaminan platform.

const fake = createFakeAdminDb();
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__', increment: (n: number) => ({ __increment: n }) },
}));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db }));

import { CLASS_SCOPED_COLLECTIONS, renameClassServer } from '../lib/server/classAdminService';

const UID = 'guru1';
const db = () => fake.db as never;
const rename = (o = 'X-1', n = 'X-2', opts = {}) => renameClassServer(UID, o, n, db(), opts);
const countWith = (cls: string, ws = 'w1') =>
  Object.entries(fake.store).filter(([k, v]) => !k.startsWith('class_rename_jobs/') && !k.startsWith('teacher_profiles/') && v.className === cls && v.workspaceId === ws).length;

function seedClass(ws: string, cls: string, perCollection: Record<string, number>) {
  for (const [c, n] of Object.entries(perCollection)) for (let i = 0; i < n; i++) fake.store[`${c}/${ws}-${cls}-${c}-${i}`] = { workspaceId: ws, className: cls, n: i };
}

beforeEach(() => {
  fake.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake.store[`teacher_profiles/${UID}`] = { workspaceId: 'w1', role: 'TEACHER' };
});

describe('renameClassServer — jalur normal', () => {
  it('kelas kecil: semua koleksi (termasuk profil siswa, kode login, siswa soft-deleted) pindah; milik workspace lain tidak tersentuh', async () => {
    seedClass('w1', 'X-1', { students: 3, student_profiles: 2, student_login_codes: 3, journals: 4, grades: 5, submissions: 2 });
    fake.store['students/deleted'] = { workspaceId: 'w1', className: 'X-1', deletedAt: 123, deletedBatchId: 'b' };
    seedClass('w2', 'X-1', { students: 2, journals: 2 }); // tenant lain, nama kelas sama
    const res = await rename();
    expect(res).toMatchObject({ done: true, className: 'X-2', renamedCount: 20 });
    expect(countWith('X-1', 'w1')).toBe(0);
    expect(countWith('X-2', 'w1')).toBe(20);
    expect(fake.store['students/deleted'].className).toBe('X-2'); // pulih nanti tetap konsisten
    expect(countWith('X-1', 'w2')).toBe(4); // tenant lain utuh
    expect(fake.store['class_rename_jobs/w1']).toMatchObject({ status: 'done', renamedCount: 20, leaseUntil: 0 });
  });

  it('mencakup SEMUA koleksi ber-className', () => {
    expect(CLASS_SCOPED_COLLECTIONS).toEqual(expect.arrayContaining(['students', 'student_profiles', 'student_login_codes', 'grades', 'grade_columns', 'assignments', 'submissions']));
  });

  it('batas 500 operasi/batch dihormati untuk kelas raksasa: 1.300 dokumen -> batch <= 451, semuanya pindah', async () => {
    seedClass('w1', 'X-1', { students: 1300, grades: 600 });
    const res = await rename();
    expect(res).toMatchObject({ done: true, renamedCount: 1900 });
    expect(Math.max(...fake.hooks.batchSizes)).toBeLessThanOrEqual(451); // 450 dokumen + 1 dokumen job
    expect(fake.hooks.batchSizes.every((n) => n <= 500)).toBe(true);
    expect(fake.hooks.batchSizes.length).toBeGreaterThanOrEqual(5);
    expect(countWith('X-1')).toBe(0);
    expect(countWith('X-2')).toBe(1900);
  });
});

describe('renameClassServer — kegagalan di tengah jalan', () => {
  it('batch ke-2 gagal: melapor error generik (tanpa penyebab Firestore), progres = dokumen yang BENAR-BENAR pindah, kunci dilepas', async () => {
    seedClass('w1', 'X-1', { students: 1000 });
    fake.hooks.failCommitNumber = 2;
    const err = await rename().catch((e) => e);
    expect(err).toMatchObject({ status: 500 });
    expect(err.message).toMatch(/450 dokumen sudah memakai nama "X-2"/);
    expect(err.message).toMatch(/Ulangi penggantian nama yang sama/);
    expect(err.message).not.toMatch(/DEADLINE_EXCEEDED/);
    expect(countWith('X-2')).toBe(450); // batch pertama utuh; batch gagal tidak menulis apa pun (atomik)
    expect(countWith('X-1')).toBe(550);
    expect(fake.store['class_rename_jobs/w1']).toMatchObject({ status: 'running', renamedCount: 450, leaseUntil: 0 });
  });

  it('mengulang rename yang sama MELANJUTKAN sampai tuntas; total konsisten, tidak ada dokumen tertinggal/ganda', async () => {
    seedClass('w1', 'X-1', { students: 1000, journals: 300 });
    fake.hooks.failCommitNumber = 2;
    await rename().catch(() => {});
    fake.hooks.failCommitNumber = 0;
    const res = await rename();
    expect(res).toMatchObject({ done: true, renamedCount: 1300 });
    expect(countWith('X-1')).toBe(0);
    expect(countWith('X-2')).toBe(1300);
  });

  it('gagal di batch pertama: nol perubahan, renamedCount 0', async () => {
    seedClass('w1', 'X-1', { students: 10 });
    fake.hooks.failCommitNumber = 1;
    const err = await rename().catch((e) => e);
    expect(err.message).toMatch(/0 dokumen sudah memakai nama/);
    expect(countWith('X-1')).toBe(10);
  });

  it('kehabisan waktu: berhenti rapi di batas batch dengan done:false, lalu dilanjutkan pemanggilan berikutnya', async () => {
    seedClass('w1', 'X-1', { students: 1000 });
    let t = 1_000_000;
    const now = () => (t += 10_000); // tiap pembacaan jam memajukan 10 dtk
    const first = await rename('X-1', 'X-2', { now, timeBudgetMs: 25_000 });
    expect(first.done).toBe(false);
    expect(first.renamedCount).toBeGreaterThan(0);
    expect(first.renamedCount).toBeLessThan(1000);
    let guard = 0;
    let last = first;
    while (!last.done && guard++ < 20) last = await rename('X-1', 'X-2', { now, timeBudgetMs: 25_000 });
    expect(last).toMatchObject({ done: true, renamedCount: 1000 });
    expect(countWith('X-1')).toBe(0);
  });
});

describe('renameClassServer — kunci job per workspace', () => {
  beforeEach(() => seedClass('w1', 'X-1', { students: 3 }));

  it('rename lain yang masih berjalan (sewa aktif): 409, tidak ada yang berubah', async () => {
    fake.store['class_rename_jobs/w1'] = { status: 'running', oldName: 'A', newName: 'B', renamedCount: 0, leaseUntil: Date.now() + 60_000 };
    await expect(rename()).rejects.toMatchObject({ status: 409 });
    expect(countWith('X-1')).toBe(3);
  });

  it('rename lain yang terputus (sewa habis) harus diselesaikan dulu: 409 menyebut nama-namanya', async () => {
    fake.store['class_rename_jobs/w1'] = { status: 'running', oldName: 'A', newName: 'B', renamedCount: 5, leaseUntil: 1 };
    const err = await rename().catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/"A" → "B"/);
    expect(countWith('X-1')).toBe(3);
  });

  it('rename yang SAMA dan terputus (sewa habis) dilanjutkan, dengan total kumulatif', async () => {
    fake.store['class_rename_jobs/w1'] = { status: 'running', oldName: 'X-1', newName: 'X-2', renamedCount: 7, leaseUntil: 1 };
    const res = await rename();
    expect(res).toMatchObject({ done: true, renamedCount: 10 }); // 7 sebelumnya + 3 sekarang
  });

  it('job lama berstatus done/failed tidak menghalangi rename baru', async () => {
    fake.store['class_rename_jobs/w1'] = { status: 'done', oldName: 'P', newName: 'Q', renamedCount: 9, leaseUntil: 0 };
    expect(await rename()).toMatchObject({ done: true, renamedCount: 3 });
  });

  it('workspace lain tidak terpengaruh kunci workspace ini', async () => {
    fake.store['teacher_profiles/guru2'] = { workspaceId: 'w2' };
    seedClass('w2', 'Y-1', { students: 2 });
    fake.store['class_rename_jobs/w1'] = { status: 'running', oldName: 'A', newName: 'B', renamedCount: 0, leaseUntil: Date.now() + 60_000 };
    expect(await renameClassServer('guru2', 'Y-1', 'Y-2', db())).toMatchObject({ done: true });
  });
});

describe('renameClassServer — validasi', () => {
  it('403 tanpa workspace, 400 nama sama/kosong/terlalu panjang, 404 kelas tak ada, 409 nama sudah dipakai (melepas kunci)', async () => {
    seedClass('w1', 'X-1', { students: 2 });
    seedClass('w1', 'X-9', { students: 1 });
    await expect(renameClassServer('hantu', 'X-1', 'X-2', db())).rejects.toMatchObject({ status: 403 });
    await expect(rename('X-1', 'X-1')).rejects.toMatchObject({ status: 400 });
    await expect(rename('X-1', '   ')).rejects.toMatchObject({ status: 400 });
    await expect(rename('X-1', 'a'.repeat(101))).rejects.toMatchObject({ status: 400 });
    await expect(rename('TIDAK-ADA', 'Z')).rejects.toMatchObject({ status: 404 });
    await expect(rename('X-1', 'X-9')).rejects.toMatchObject({ status: 409 });
    expect(fake.store['class_rename_jobs/w1'].leaseUntil).toBe(0); // gagal validasi tidak mengunci workspace
    expect(countWith('X-1')).toBe(2);
    expect(await rename('X-1', 'X-2')).toMatchObject({ done: true }); // dan rename berikutnya jalan
  });

  it('nama baru dirapikan spasinya', async () => {
    seedClass('w1', 'X-1', { students: 1 });
    expect(await rename('  X-1 ', '  XI   A   2 ')).toMatchObject({ className: 'XI A 2' });
  });
});
