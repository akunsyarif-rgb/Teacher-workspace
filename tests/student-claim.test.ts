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

import { POST } from '../app/api/student/claim/route';
import { checkRateLimits, clientIp, recordFailures } from '../lib/server/rateLimit';

const req = (body: unknown, opts: { token?: string | null; ip?: string } = {}) => {
  const { token = 'tok', ip = '1.1.1.1' } = opts;
  return new NextRequest('http://localhost/api/student/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
};

beforeEach(() => {
  fake.reset();
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'anon1' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake.store['students/s1'] = { workspaceId: 'w1', className: 'XI-A', name: 'Budi', accessCode: 'ABCD2345' };
  fake.store['student_login_codes/ABCD2345'] = { studentId: 's1', workspaceId: 'w1', className: 'XI-A', name: 'Budi', nis: '123' };
});

describe('POST /api/student/claim', () => {
  it('401 tanpa token / token tidak valid', async () => {
    expect((await POST(req({ accessCode: 'ABCD2345' }, { token: null }))).status).toBe(401);
    verifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(401);
  });

  it('kode valid (huruf kecil/spasi diterima): profil dibuat server dengan uid dari TOKEN', async () => {
    const res = await POST(req({ accessCode: '  abcd2345 ', uid: 'penyerang' }));
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toEqual({
      studentId: 's1', workspaceId: 'w1', className: 'XI-A', name: 'Budi', nis: '123', accessCode: 'ABCD2345',
    });
    expect(fake.store['student_profiles/anon1']).toMatchObject({ studentId: 's1', workspaceId: 'w1', createdAt: '__TS__' });
    expect(fake.store['student_profiles/penyerang']).toBeUndefined();
  });

  it('kode tidak dikenal / format tidak valid: 404 generik, tanpa membocorkan apa pun', async () => {
    for (const accessCode of ['ZZZZ9999', '!!', 'a'.repeat(100)]) {
      const res = await POST(req({ accessCode }));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/tidak ditemukan/);
    }
    expect(fake.store['student_profiles/anon1']).toBeUndefined();
  });

  it('kode kosong: 400 dan tidak dihitung sebagai tebakan', async () => {
    expect((await POST(req({ accessCode: '' }))).status).toBe(400);
    expect(Object.keys(fake.store).some((k) => k.startsWith('rate_limits/'))).toBe(false);
  });

  it('siswa sudah dihapus tapi kodenya tersisa: ditolak', async () => {
    delete fake.store['students/s1'];
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(404);
  });

  it('siswa yang di-soft-delete tidak bisa masuk walau kodenya masih ada; bisa lagi setelah dipulihkan', async () => {
    fake.store['students/s1'].deletedAt = { seconds: 1 };
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(404);
    expect(fake.store['student_profiles/anon1']).toBeUndefined();
    fake.store['students/s1'].deletedAt = null; // dipulihkan
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(200);
  });

  it('siswa dari workspace lain dengan studentId sama tidak lolos', async () => {
    fake.store['students/s1'].workspaceId = 'w-lain';
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(404);
  });

  it('kode versi lama (tanpa className/name): 409 dan tidak dihitung tebakan', async () => {
    fake.store['student_login_codes/ABCD2345'] = { studentId: 's1', workspaceId: 'w1' };
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(409);
    expect(Object.keys(fake.store).some((k) => k.startsWith('rate_limits/'))).toBe(false);
  });

  it('akun yang sudah menjadi siswa A tidak bisa dialihkan ke siswa B; kode yang sama diulang idempoten', async () => {
    fake.store['students/s2'] = { workspaceId: 'w1', className: 'XI-A', name: 'Ani' };
    fake.store['student_login_codes/QWER5678'] = { studentId: 's2', workspaceId: 'w1', className: 'XI-A', name: 'Ani' };
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(200);
    expect((await POST(req({ accessCode: 'ABCD2345' }))).status).toBe(200);
    const other = await POST(req({ accessCode: 'QWER5678' }));
    expect(other.status).toBe(409);
    expect(fake.store['student_profiles/anon1'].studentId).toBe('s1');
  });
});

describe('rate limit percobaan gagal /api/student/claim', () => {
  it('uid yang menebak terus diblokir 429 (+Retry-After) setelah 8 tebakan salah — bahkan untuk kode yang benar', async () => {
    for (let i = 0; i < 8; i++) expect((await POST(req({ accessCode: `SALAH${i}XX` }))).status).toBe(404);
    const blocked = await POST(req({ accessCode: 'ABCD2345' }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(fake.store['student_profiles/anon1']).toBeUndefined();
  });

  it('membuat akun anonim baru TIDAK menghapus blokir: batas per-IP ikut menghalangi (40 gagal)', async () => {
    for (let i = 0; i < 40; i++) {
      verifyIdToken.mockResolvedValue({ uid: `anon-${Math.floor(i / 5)}` }); // 5 tebakan per akun baru
      await POST(req({ accessCode: `SALAH${i}XX` }, { ip: '9.9.9.9' }));
    }
    verifyIdToken.mockResolvedValue({ uid: 'akun-segar' });
    expect((await POST(req({ accessCode: 'ABCD2345' }, { ip: '9.9.9.9' }))).status).toBe(429);
    // IP lain tidak terdampak
    expect((await POST(req({ accessCode: 'ABCD2345' }, { ip: '2.2.2.2' }))).status).toBe(200);
  });

  it('satu kelas (IP sekolah sama) yang login dengan kode BENAR tidak pernah terblokir', async () => {
    for (let i = 0; i < 60; i++) {
      verifyIdToken.mockResolvedValue({ uid: `siswa-${i}` });
      expect((await POST(req({ accessCode: 'ABCD2345' }, { ip: '3.3.3.3' }))).status).toBe(200);
    }
  });
});

describe('rateLimit — jendela waktu', () => {
  const rule = { key: 'k', limit: 3, windowSeconds: 60 };
  const db = () => fake.db as any;

  it('menolak setelah limit tercapai lalu pulih setelah jendela habis', async () => {
    for (let i = 0; i < 3; i++) await recordFailures(db(), [rule], 1_000);
    const blocked = await checkRateLimits(db(), [rule], 30_000);
    expect(blocked).toEqual({ ok: false, retryAfterSeconds: 31 });
    expect(await checkRateLimits(db(), [rule], 61_001)).toEqual({ ok: true });
    await recordFailures(db(), [rule], 61_001); // jendela baru mulai dari 1
    expect(await checkRateLimits(db(), [rule], 61_002)).toEqual({ ok: true });
  });

  it('kunci disimpan sebagai hash (IP/uid tidak muncul mentah)', async () => {
    await recordFailures(db(), [{ key: 'student-claim:ip:203.0.113.7', limit: 1, windowSeconds: 60 }], 1);
    expect(Object.keys(fake.store).join()).not.toContain('203.0.113.7');
  });

  it('clientIp memakai x-real-ip, lalu entri pertama x-forwarded-for, lalu "unknown"', () => {
    const h = (o: Record<string, string>) => new Request('http://x', { headers: o });
    expect(clientIp(h({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
    expect(clientIp(h({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }))).toBe('5.6.7.8');
    expect(clientIp(h({}))).toBe('unknown');
  });
});
