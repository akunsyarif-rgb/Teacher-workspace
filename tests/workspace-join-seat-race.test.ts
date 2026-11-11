import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

// joinWorkspaceByCodeServer di atas fake Admin DB yang menyerialkan transaksi.
// Ini menguji LOGIKA transaksi (cek kuota + tulis atomik, kalah -> baca ulang).
// Penguncian sungguhan di Firestore tidak diuji di sini.

const fake = createFakeAdminDb();
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__TS__', delete: () => '__DEL__' } }));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({}) }));

import { joinWorkspaceByCodeServer } from '../lib/server/workspaceAdminService';

const members = () => Object.keys(fake.store).filter((k) => k.startsWith('teacher_profiles/') && fake.store[k].workspaceId === 'w1');

beforeEach(() => {
  fake.reset();
  fake.store['workspaces/w1'] = { name: 'Sekolah', plan: 'school_annual', ownerUid: 'owner', seatLimit: 3, inviteCode: 'ABC234', inviteCodeExpiresAt: Date.now() + 100_000 };
  fake.store['workspace_invites/ABC234'] = { workspaceId: 'w1' };
  fake.store['teacher_profiles/owner'] = { workspaceId: 'w1', role: 'OWNER' };
});

describe('joinWorkspaceByCodeServer — kuota kursi atomik', () => {
  it('10 guru join BERSAMAAN ke workspace dengan 2 kursi tersisa: tepat 2 yang masuk', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => joinWorkspaceByCodeServer(`t${i}`, 'ABC234')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(8);
    rejected.forEach((r) => expect(r.reason).toMatchObject({ status: 409 }));
    expect(members()).toHaveLength(3); // owner + 2, tidak pernah melebihi seatLimit
  });

  it('join berurutan: kursi terakhir terpakai lalu ditolak dengan pesan kuota penuh', async () => {
    await joinWorkspaceByCodeServer('t1', 'ABC234');
    await joinWorkspaceByCodeServer('t2', 'ABC234');
    await expect(joinWorkspaceByCodeServer('t3', 'ABC234')).rejects.toThrow(/Kuota guru workspace ini sudah penuh \(maks 3 guru\)/);
    expect(fake.store['teacher_profiles/t3']).toBeUndefined();
  });

  it('seatLimit tidak ada/null = tak terbatas', async () => {
    fake.store['workspaces/w1'].seatLimit = null;
    await Promise.all(Array.from({ length: 8 }, (_, i) => joinWorkspaceByCodeServer(`t${i}`, 'ABC234')));
    expect(members()).toHaveLength(9);
  });

  it('akun yang sama join dua kali bersamaan: hanya satu yang berhasil, tidak memakai dua kursi', async () => {
    const results = await Promise.allSettled([joinWorkspaceByCodeServer('t1', 'ABC234'), joinWorkspaceByCodeServer('t1', 'ABC234')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(members()).toHaveLength(2);
  });

  it('join sukses menulis profil TEACHER dan menyentuh dokumen workspace (titik konflik bersama)', async () => {
    const ws = await joinWorkspaceByCodeServer('t1', 'abc234 ');
    expect(ws).toMatchObject({ id: 'w1', name: 'Sekolah' });
    expect(fake.store['teacher_profiles/t1']).toMatchObject({ workspaceId: 'w1', role: 'TEACHER', isActive: true });
    expect(fake.store['workspaces/w1'].updatedAt).toBe('__TS__');
  });

  it('transaksi yang gagal tidak menulis apa pun (rollback)', async () => {
    fake.store['workspaces/w1'].seatLimit = 1;
    await expect(joinWorkspaceByCodeServer('t1', 'ABC234')).rejects.toThrow();
    expect(fake.store['teacher_profiles/t1']).toBeUndefined();
    expect(fake.store['workspaces/w1'].updatedAt).toBeUndefined();
  });

  it.each([
    ['kode kosong', ' ', 400],
    ['kode tidak ada', 'NOPE99', 404],
  ])('%s -> ApiError %i', async (_n, code, status) => {
    await expect(joinWorkspaceByCodeServer('t1', code)).rejects.toMatchObject({ status });
  });

  it('kode lama (sudah diganti) 404; kode kedaluwarsa 410; sudah punya workspace 409', async () => {
    fake.store['workspaces/w1'].inviteCode = 'BARU22';
    await expect(joinWorkspaceByCodeServer('t1', 'ABC234')).rejects.toMatchObject({ status: 404 });
    fake.store['workspaces/w1'].inviteCode = 'ABC234';
    fake.store['workspaces/w1'].inviteCodeExpiresAt = Date.now() - 1;
    await expect(joinWorkspaceByCodeServer('t1', 'ABC234')).rejects.toMatchObject({ status: 410 });
    fake.store['workspaces/w1'].inviteCodeExpiresAt = Date.now() + 1000;
    fake.store['teacher_profiles/t9'] = { workspaceId: 'w-lain', role: 'OWNER' };
    await expect(joinWorkspaceByCodeServer('t9', 'ABC234')).rejects.toMatchObject({ status: 409 });
  });
});
