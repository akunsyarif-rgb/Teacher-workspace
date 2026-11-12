import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const verifyIdToken = vi.fn();
const getAdminAuth = vi.fn(() => ({ verifyIdToken }));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminAuth: () => getAdminAuth() }));

import { AuthFailure, authenticate, extractBearerToken, requireAuth } from '../lib/server/requireAuth';

const req = (token?: string | null, header = 'authorization') =>
  new Request('http://localhost/api/x', { method: 'POST', headers: token ? { [header]: token } : {} });

beforeEach(() => {
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'u1', email: 'a@b.id' });
  getAdminAuth.mockReset().mockImplementation(() => ({ verifyIdToken }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('extractBearerToken', () => {
  it('mengambil token setelah "Bearer " (tanpa peduli huruf besar-kecil) dan memangkas spasi', () => {
    expect(extractBearerToken(req('Bearer abc.def'))).toBe('abc.def');
    expect(extractBearerToken(req('bearer   abc  '))).toBe('abc');
    expect(extractBearerToken(req())).toBe('');
  });
});

describe('authenticate / requireAuth', () => {
  it('default MEMERIKSA pencabutan sesi: verifyIdToken(token, true)', async () => {
    const user = await authenticate(req('Bearer tok'));
    expect(user.uid).toBe('u1');
    expect(verifyIdToken).toHaveBeenCalledWith('tok', true);
  });

  it('checkRevoked:false hanya bila diminta eksplisit', async () => {
    await authenticate(req('Bearer tok'), { checkRevoked: false });
    expect(verifyIdToken).toHaveBeenCalledWith('tok', false);
  });

  it('tanpa token: 401 no_token, verifyIdToken tidak dipanggil', async () => {
    const res = (await requireAuth(req())) as NextResponse;
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('no_token');
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('token ditolak (kedaluwarsa/dicabut/rusak): 401 invalid_token tanpa membocorkan pesan Firebase', async () => {
    verifyIdToken.mockRejectedValue(Object.assign(new Error('Firebase ID token has been revoked at project xyz'), { code: 'auth/id-token-revoked' }));
    const res = (await requireAuth(req('Bearer tok'))) as NextResponse;
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.code).toBe('invalid_token');
    expect(JSON.stringify(j)).not.toMatch(/revoked|xyz|project/);
  });

  it('kode galat Firebase tersedia di AuthFailure (untuk diagnosa) dalam bentuk yang disanitasi', async () => {
    verifyIdToken.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/id-token-revoked<script>' }));
    const err = await authenticate(req('Bearer tok')).catch((e) => e);
    expect(err).toBeInstanceOf(AuthFailure);
    expect(err.firebaseCode).toBe('auth/id-token-revokedscript');
  });

  it('Admin SDK tidak terkonfigurasi: 503 server_config, detail internal hanya ke log', async () => {
    getAdminAuth.mockImplementation(() => {
      throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT belum di-set. Tambahkan di Vercel');
    });
    const res = (await requireAuth(req('Bearer tok'))) as NextResponse;
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j.code).toBe('server_config');
    expect(JSON.stringify(j)).not.toMatch(/FIREBASE_ADMIN_SERVICE_ACCOUNT|Vercel/);
    expect(console.error).toHaveBeenCalled();
  });

  it('configErrorMessage dan headers kustom dihormati', async () => {
    getAdminAuth.mockImplementation(() => {
      throw new Error('x');
    });
    const res = (await requireAuth(req('Bearer tok'), { configErrorMessage: 'Hubungi gurumu.', headers: { 'Cache-Control': 'no-store' } })) as NextResponse;
    expect((await res.json()).error).toBe('Hubungi gurumu.');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// Guard regresi: logika token tidak boleh disalin lagi ke route.
describe('semua route /api memakai requireAuth', () => {
  const root = path.resolve(__dirname, '..', 'app', 'api');
  const routes: string[] = [];
  (function walk(dir: string) {
    for (const f of readdirSync(dir)) {
      const full = path.join(dir, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (f === 'route.ts') routes.push(full);
    }
  })(root);

  it('ada route yang ditemukan', () => expect(routes.length).toBeGreaterThanOrEqual(12));

  it.each(routes.map((r) => [path.relative(root, r), r]))('%s tidak memanggil verifyIdToken sendiri', (_name, file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/verifyIdToken\s*\(/);
  });

  it('route terproteksi memakai requireAuth/authenticate (kecuali webhook Midtrans yang diverifikasi signature dan /api/version yang publik)', () => {
    for (const file of routes) {
      const src = readFileSync(file, 'utf8');
      const isWebhook = file.includes(`${path.sep}payments${path.sep}webhook${path.sep}`);
      // /api/version sengaja publik: hanya mengembalikan hash build (dipakai banner pembaruan di klien).
      const isPublicVersion = file.includes(`${path.sep}api${path.sep}version${path.sep}`);
      if (isWebhook || isPublicVersion) expect(src).not.toMatch(/requireAuth|authenticate\(/);
      else expect(src, file).toMatch(/requireAuth\(|authenticate\(/);
    }
  });
});
