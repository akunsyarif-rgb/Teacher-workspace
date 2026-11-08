import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

const fake = createFakeAdminDb();
const verifyIdToken = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__', increment: (n: number) => ({ __increment: n }) },
}));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({ verifyIdToken }) }));

import { POST as deleteRoute } from '../app/api/classes/delete/route';
import { POST as restoreRoute } from '../app/api/classes/restore/route';
import { deleteClassServer, restoreClassServer } from '../lib/server/classLifecycleService';

const db = () => fake.db as never;
const req = (url: string, body: unknown, token: string | null = 'tok') =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

function seedStudents(ws: string, cls: string, n: number, extra: Record<string, unknown> = {}) {
  for (let i = 0; i < n; i++) fake.store[`students/${ws}-${cls}-${i}`] = { workspaceId: ws, className: cls, name: `S${i}`, ...extra };
}
const deletedIn = (cls: string, ws = 'w1') => Object.values(fake.store).filter((v) => v.workspaceId === ws && v.className === cls && v.deletedAt);

beforeEach(() => {
  fake.reset();
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'owner1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake.store['teacher_profiles/owner1'] = { workspaceId: 'w1', role: 'OWNER' };
  fake.store['teacher_profiles/admin1'] = { workspaceId: 'w1', role: 'ADMIN' };
  fake.store['teacher_profiles/guru1'] = { workspaceId: 'w1', role: 'TEACHER' };
  fake.store['workspaces/w1'] = { plan: 'individual_monthly', classLimit: null };
});

describe('hapus kelas (soft delete) — khusus OWNER/ADMIN', () => {
  it('guru biasa ditolak 403 dan tidak ada yang berubah', async () => {
    seedStudents('w1', '7A', 3);
    await expect(deleteClassServer('guru1', '7A', db())).rejects.toMatchObject({ status: 403 });
    expect(deletedIn('7A')).toHaveLength(0);
  });

  it('OWNER dan ADMIN boleh; siswa hanya ditandai (TIDAK dihapus), kelas lain & workspace lain utuh', async () => {
    seedStudents('w1', '7A', 3);
    seedStudents('w1', '7B', 2);
    seedStudents('w2', '7A', 4);
    const res = await deleteClassServer('admin1', '7A', db());
    expect(res.deletedCount).toBe(3);
    expect(deletedIn('7A')).toHaveLength(3);
    expect(deletedIn('7A')[0]).toMatchObject({ deletedAt: '__TS__', deletedBy: 'admin1', deletedBatchId: res.batchId });
    expect(Object.keys(fake.store).filter((k) => k.startsWith('students/w1-7A'))).toHaveLength(3); // dokumen masih ada
    expect(deletedIn('7B')).toHaveLength(0);
    expect(deletedIn('7A', 'w2')).toHaveLength(0);
  });

  it('kelas besar dipecah <= 450 per batch dan semuanya ditandai', async () => {
    seedStudents('w1', '7A', 1100);
    await deleteClassServer('owner1', '7A', db());
    expect(deletedIn('7A')).toHaveLength(1100);
    expect(Math.max(...fake.hooks.batchSizes)).toBeLessThanOrEqual(450);
  });

  it('kelas tidak ada / sudah terhapus: 404; nama kosong: 400', async () => {
    seedStudents('w1', '7A', 1);
    await deleteClassServer('owner1', '7A', db());
    await expect(deleteClassServer('owner1', '7A', db())).rejects.toMatchObject({ status: 404 });
    await expect(deleteClassServer('owner1', '  ', db())).rejects.toMatchObject({ status: 400 });
  });

  it('route: 401 tanpa token, 403 guru biasa dengan pesan yang aman, 200 untuk OWNER', async () => {
    seedStudents('w1', '7A', 2);
    expect((await deleteRoute(req('/api/classes/delete', { className: '7A' }, null))).status).toBe(401);
    verifyIdToken.mockResolvedValue({ uid: 'guru1' });
    const denied = await deleteRoute(req('/api/classes/delete', { className: '7A' }));
    expect(denied.status).toBe(403);
    verifyIdToken.mockResolvedValue({ uid: 'owner1' });
    const ok = await deleteRoute(req('/api/classes/delete', { className: '7A' }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).deletedCount).toBe(2);
    expect(verifyIdToken).toHaveBeenCalledWith('tok', true);
  });
});

describe('pulihkan kelas', () => {
  it('memulihkan siswa yang terhapus lewat "hapus kelas", bukan yang dihapus satu per satu', async () => {
    seedStudents('w1', '7A', 3);
    fake.store['students/satuan'] = { workspaceId: 'w1', className: '7A', deletedAt: 5, deletedBy: 'guru1' }; // tanpa deletedBatchId
    await deleteClassServer('owner1', '7A', db());
    const res = await restoreClassServer('owner1', '7A', db());
    expect(res.restoredCount).toBe(3);
    expect(fake.store['students/w1-7A-0']).toMatchObject({ deletedAt: null, deletedBy: null, deletedBatchId: null });
    expect(fake.store['students/satuan'].deletedAt).toBe(5); // tetap terhapus
  });

  it('guru biasa ditolak; kelas tanpa data terhapus 404', async () => {
    seedStudents('w1', '7A', 2);
    await deleteClassServer('owner1', '7A', db());
    await expect(restoreClassServer('guru1', '7A', db())).rejects.toMatchObject({ status: 403 });
    await expect(restoreClassServer('owner1', '7Z', db())).rejects.toMatchObject({ status: 404 });
  });

  it('batas kelas paket berlaku lagi saat memulihkan (kelas aktif lain sudah memenuhi kuota)', async () => {
    fake.store['workspaces/w1'] = { plan: 'individual_lifetime', classLimit: 1 };
    seedStudents('w1', '7A', 2);
    await deleteClassServer('owner1', '7A', db());
    seedStudents('w1', '7B', 1); // kelas baru mengisi satu-satunya jatah
    await expect(restoreClassServer('owner1', '7A', db())).rejects.toMatchObject({ status: 403 });
    expect(deletedIn('7A')).toHaveLength(2);
  });

  it('paket kedaluwarsa memakai batas gratis saat memulihkan', async () => {
    fake.store['workspaces/w1'] = { plan: 'individual_monthly', classLimit: null, planExpiresAt: 1 };
    seedStudents('w1', '7A', 1);
    await deleteClassServer('owner1', '7A', db());
    for (const c of ['1', '2', '3']) seedStudents('w1', c, 1);
    await expect(restoreClassServer('owner1', '7A', db())).rejects.toMatchObject({ status: 403 });
  });

  it('route restore: 200 untuk OWNER', async () => {
    seedStudents('w1', '7A', 2);
    await deleteRoute(req('/api/classes/delete', { className: '7A' }));
    const res = await restoreRoute(req('/api/classes/restore', { className: '7A' }));
    expect(res.status).toBe(200);
    expect((await res.json()).restoredCount).toBe(2);
  });
});
