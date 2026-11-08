import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

const fake = createFakeAdminDb();
const verifyIdToken = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__' },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({ verifyIdToken }) }));
// Setelah lolos pembatas, ekspor ditolak di tahap aktor (403) — cukup untuk membuktikan urutan: pembatas di depan.
vi.mock('@/lib/server/backup/actor', async (orig) => {
  const real = await orig<typeof import('../lib/server/backup/actor')>();
  return { ...real, resolveBackupActor: vi.fn(async () => { throw new real.BackupAuthError('not_a_teacher'); }) };
});

import { limitRequests } from '../lib/server/rateLimit';
import { POST as exportRoute } from '../app/api/backup/export/route';
import { POST as attachmentsRoute } from '../app/api/backup/attachments/route';

const req = (url = '/x', ip = '1.1.1.1', body: unknown = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok', 'x-real-ip': ip },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  fake.reset();
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'guru1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('limitRequests', () => {
  const opts = { perUid: 3, perIp: 100, windowSeconds: 60 };
  const db = () => fake.db as never;

  it('menghitung SETIAP permintaan (bukan hanya gagal) dan menolak setelah batas', async () => {
    for (let i = 0; i < 3; i++) expect(await limitRequests(db(), req(), 'guru1', 'scope', opts)).toBeNull();
    const blocked = await limitRequests(db(), req(), 'guru1', 'scope', opts);
    expect(blocked?.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked?.message).toMatch(/Terlalu banyak permintaan/);
  });
  it('uid lain dan scope lain tidak terdampak', async () => {
    for (let i = 0; i < 3; i++) await limitRequests(db(), req(), 'guru1', 'scope', opts);
    expect(await limitRequests(db(), req(), 'guru2', 'scope', opts)).toBeNull();
    expect(await limitRequests(db(), req(), 'guru1', 'scope-lain', opts)).toBeNull();
  });
  it('batas per-IP berlaku walau uid berganti', async () => {
    const ipOpts = { perUid: 100, perIp: 2, windowSeconds: 60 };
    await limitRequests(db(), req('/x', '8.8.8.8'), 'a', 's', ipOpts);
    await limitRequests(db(), req('/x', '8.8.8.8'), 'b', 's', ipOpts);
    expect(await limitRequests(db(), req('/x', '8.8.8.8'), 'c', 's', ipOpts)).not.toBeNull();
  });
});

describe('backup export & lampiran dibatasi lajunya', () => {
  it('export: 12 permintaan/jam per uid, ke-13 -> 429 rate_limited + Retry-After (sebelum menyentuh data)', async () => {
    for (let i = 0; i < 12; i++) expect((await exportRoute(req('/api/backup/export'))).status).toBe(403);
    const res = await exportRoute(req('/api/backup/export'));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('rate_limited');
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('lampiran: batas lebih longgar (400/jam) dan terpisah dari export', async () => {
    for (let i = 0; i < 12; i++) await exportRoute(req('/api/backup/export'));
    expect((await exportRoute(req('/api/backup/export'))).status).toBe(429);
    expect((await attachmentsRoute(req('/api/backup/attachments', '1.1.1.1', { action: 'plan' }))).status).toBe(403);
  });
  it('401 tanpa token tetap lebih dulu dari pembatas', async () => {
    const r = new NextRequest('http://localhost/api/backup/export', { method: 'POST', body: '{}' });
    expect((await exportRoute(r)).status).toBe(401);
  });
  it('sesi dicabut ditolak 401 (checkRevoked default)', async () => {
    verifyIdToken.mockRejectedValue(Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' }));
    expect((await exportRoute(req('/api/backup/export'))).status).toBe(401);
    expect(verifyIdToken).toHaveBeenCalledWith('tok', true);
  });
});
