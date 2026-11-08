import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

// Error internal (konfigurasi, SDK) tidak boleh sampai ke client; error yang
// disengaja (ApiError) tetap tampil dengan status yang benar.

const fake = createFakeAdminDb();
const verifyIdToken = vi.fn();
const join = vi.fn();
const rename = vi.fn();
const createPayment = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__' },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({ verifyIdToken }) }));
vi.mock('@/lib/server/workspaceAdminService', () => ({ joinWorkspaceByCodeServer: (...a: unknown[]) => join(...a) }));
vi.mock('@/lib/server/classAdminService', () => ({ renameClassServer: (...a: unknown[]) => rename(...a) }));
vi.mock('@/lib/server/paymentService', () => ({ createPaymentTransaction: (...a: unknown[]) => createPayment(...a) }));

import { ApiError } from '../lib/server/apiErrors';
import { POST as joinRoute } from '../app/api/workspace/join/route';
import { POST as renameRoute } from '../app/api/classes/rename/route';
import { POST as payRoute } from '../app/api/payments/create-transaction/route';

const LEAKY = 'FIREBASE_ADMIN_SERVICE_ACCOUNT belum di-set. Isi JSON service account project teacher-prod-123 (private_key_id=abc)';
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok', 'x-real-ip': '1.1.1.1' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  fake.reset();
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'u1', email: 'g@x.id' });
  join.mockReset();
  rename.mockReset();
  createPayment.mockReset();
  fake.store['workspaces/w1'] = { ownerUid: 'u1' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('workspace/join', () => {
  it('error internal -> 500 generik tanpa detail; tidak dihitung sebagai tebakan kode', async () => {
    join.mockRejectedValue(new Error(LEAKY));
    const res = await joinRoute(post('/api/workspace/join', { inviteCode: 'ABC234' }));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/FIREBASE_ADMIN|private_key|teacher-prod/);
    expect(Object.keys(fake.store).some((k) => k.startsWith('rate_limits/'))).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('ApiError disengaja tampil apa adanya dengan status-nya dan dihitung sebagai tebakan', async () => {
    join.mockRejectedValue(new ApiError('Kode undangan tidak ditemukan.', 404));
    const res = await joinRoute(post('/api/workspace/join', { inviteCode: 'SALAH1' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Kode undangan tidak ditemukan.');
    expect(Object.keys(fake.store).some((k) => k.startsWith('rate_limits/'))).toBe(true);
  });
});

describe('classes/rename', () => {
  it('error internal -> 500 generik', async () => {
    rename.mockRejectedValue(new Error(LEAKY));
    const res = await renameRoute(post('/api/classes/rename', { oldName: 'A', newName: 'B' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/FIREBASE_ADMIN|private_key/);
  });
  it('validasi disengaja (ApiError) tetap tampil', async () => {
    rename.mockRejectedValue(new ApiError('Kelas "B" sudah ada. Pilih nama lain.', 409));
    const res = await renameRoute(post('/api/classes/rename', { oldName: 'A', newName: 'B' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/sudah ada/);
  });
  it('401 tanpa token', async () => {
    const res = await renameRoute(new NextRequest('http://localhost/api/classes/rename', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });
});

describe('payments/create-transaction', () => {
  const body = { workspaceId: 'w1', plan: 'individual_monthly' };
  it('error konfigurasi Midtrans/SDK -> 500 generik', async () => {
    createPayment.mockRejectedValue(new Error('MIDTRANS_SERVER_KEY / NEXT_PUBLIC_MIDTRANS_CLIENT_KEY belum di-set di environment variable.'));
    const res = await payRoute(post('/api/payments/create-transaction', body));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/MIDTRANS|environment variable/);
  });
  it('validasi disengaja (ApiError 400) tetap tampil', async () => {
    createPayment.mockRejectedValue(new ApiError('Jumlah kursi guru wajib diisi (minimal 1) untuk paket sekolah.', 400));
    const res = await payRoute(post('/api/payments/create-transaction', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/kursi/);
  });
  it('403 untuk non-owner, dan token terverifikasi dengan pemeriksaan pencabutan', async () => {
    fake.store['workspaces/w1'] = { ownerUid: 'orang-lain' };
    expect((await payRoute(post('/api/payments/create-transaction', body))).status).toBe(403);
    expect(verifyIdToken).toHaveBeenCalledWith('tok', true);
  });
});
