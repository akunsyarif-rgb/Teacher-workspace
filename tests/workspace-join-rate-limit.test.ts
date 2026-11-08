import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

const fake = createFakeAdminDb();
const verifyIdToken = vi.fn();
const join = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__TS__' },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({ verifyIdToken }) }));
vi.mock('@/lib/server/workspaceAdminService', () => ({ joinWorkspaceByCodeServer: (...a: unknown[]) => join(...a) }));

import { POST } from '../app/api/workspace/join/route';

const req = (body: unknown, ip = '1.1.1.1') =>
  new NextRequest('http://localhost/api/workspace/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok', 'x-real-ip': ip },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  fake.reset();
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'guru1' });
  join.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/workspace/join — rate limit tebak kode undangan', () => {
  it('kode benar: 200 dan tidak menambah hitungan gagal', async () => {
    join.mockResolvedValue({ id: 'w1' });
    for (let i = 0; i < 20; i++) expect((await POST(req({ inviteCode: 'ABC234' }))).status).toBe(200);
  });

  it('6 percobaan gagal per uid -> 429; kode benar pun ditolak selama diblokir', async () => {
    join.mockRejectedValue(new Error('Kode undangan tidak ditemukan.'));
    for (let i = 0; i < 6; i++) expect((await POST(req({ inviteCode: `SALAH${i}` }))).status).toBe(400);
    join.mockResolvedValue({ id: 'w1' });
    const blocked = await POST(req({ inviteCode: 'ABC234' }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(join).toHaveBeenCalledTimes(6); // percobaan ke-7 tidak sampai ke pencarian kode
  });

  it('akun lain dari IP yang sama ikut terbatas setelah 30 kegagalan IP', async () => {
    join.mockRejectedValue(new Error('Kode undangan tidak ditemukan.'));
    for (let i = 0; i < 30; i++) {
      verifyIdToken.mockResolvedValue({ uid: `g${Math.floor(i / 5)}` });
      await POST(req({ inviteCode: `SALAH${i}` }, '7.7.7.7'));
    }
    verifyIdToken.mockResolvedValue({ uid: 'baru' });
    expect((await POST(req({ inviteCode: 'ABC234' }, '7.7.7.7'))).status).toBe(429);
  });

  it('401 tanpa token', async () => {
    const r = new NextRequest('http://localhost/api/workspace/join', { method: 'POST', body: '{}' });
    expect((await POST(r)).status).toBe(401);
  });
});
