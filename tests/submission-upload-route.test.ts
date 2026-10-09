import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Test unit dengan Admin SDK & Supabase di-mock — BUKAN bukti upload real ke
// Supabase; itu hanya bisa dibuktikan lewat uji manual di Preview.

const verifyIdToken = vi.fn();
const docs: Record<string, Record<string, unknown>> = {};
const getAdminAuth = vi.fn(() => ({ verifyIdToken }));
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminAuth: () => getAdminAuth(),
  getAdminDb: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: docs[`${c}/${id}`] !== undefined, data: () => docs[`${c}/${id}`] }),
      }),
    }),
  }),
}));

import { POST as upload } from '../app/api/submission-attachments/upload/route';
import { POST as sign } from '../app/api/submission-attachments/sign/route';

const fetchMock = vi.fn();
const body = { workspaceId: 'w1', assignmentId: 'a1', fileName: 'IMG 1.png', contentType: 'image/png', fileSize: 1000 };

function req(url: string, payload: unknown, token: string | null = 'tok') {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  getAdminAuth.mockClear();
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'u1' });
  for (const k of Object.keys(docs)) delete docs[k];
  docs['student_profiles/u1'] = { workspaceId: 'w1', className: '7A', studentId: 's1' };
  docs['assignments/a1'] = { workspaceId: 'w1', className: '7A', dueDate: '2999-01-01' };
  docs['teacher_profiles/t1'] = { workspaceId: 'w1' };
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'secret';
});

describe('POST /upload', () => {
  it('401 tanpa token', async () => {
    expect((await upload(req('/u', body, null))).status).toBe(401);
  });
  it('401 token tidak valid', async () => {
    verifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await upload(req('/u', body))).status).toBe(401);
  });
  it('503 server_config (bukan 401) bila Admin SDK tidak terkonfigurasi', async () => {
    getAdminAuth.mockImplementationOnce(() => { throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT belum di-set'); });
    const res = await upload(req('/u', body));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('server_config');
  });
  it('413 file terlalu besar, 415 tipe tidak valid', async () => {
    expect((await upload(req('/u', { ...body, fileSize: 10 * 1024 * 1024 }))).status).toBe(413);
    expect((await upload(req('/u', { ...body, contentType: 'text/html' }))).status).toBe(415);
  });
  it('403 bukan siswa / kelas beda', async () => {
    delete docs['student_profiles/u1'];
    expect((await upload(req('/u', body))).status).toBe(403);
    docs['student_profiles/u1'] = { workspaceId: 'w1', className: '9Z', studentId: 's1' };
    expect((await upload(req('/u', body))).status).toBe(403);
  });
  it('409 tenggat lewat, tanpa memanggil Supabase', async () => {
    (docs["assignments/a1"] as { dueDate: string }).dueDate = '2000-01-01';
    expect((await upload(req('/u', body))).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('502 bila Supabase error', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await upload(req('/u', body));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('500');
  });
  it('key sb_secret_ dikirim hanya via apikey; JWT lama juga via Bearer', async () => {
    fetchMock.mockImplementation(async () => Response.json({ url: '/object/upload/sign/b/p?token=T' }));
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_abc';
    await upload(req('/u', body));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].headers.apikey).toBe('sb_secret_abc');
    process.env.SUPABASE_SECRET_KEY = 'eyJhbGci.x.y';
    await upload(req('/u', body));
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer eyJhbGci.x.y');
  });
  it('URL env yang memuat path (/rest/v1/) dinormalkan ke origin', async () => {
    fetchMock.mockImplementation(async () => Response.json({ url: '/object/upload/sign/b/p?token=T' }));
    process.env.SUPABASE_URL = ' https://x.supabase.co/rest/v1/ ';
    await upload(req('/u', body));
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/x\.supabase\.co\/storage\/v1\/object\/upload\/sign\/submission-attachments\//);
  });
  it('503 bila env Supabase hilang', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await upload(req('/u', body))).status).toBe(503);
  });
  it('mengembalikan signed URL absolut + token + path milik uid', async () => {
    fetchMock.mockResolvedValue(Response.json({ url: '/object/upload/sign/submission-attachments/p?token=T1' }));
    const res = await upload(req('/u', body));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.signedUrl).toBe('https://x.supabase.co/storage/v1/object/upload/sign/submission-attachments/p?token=T1');
    expect(j.token).toBe('T1');
    expect(j.path).toMatch(/^submissions\/w1\/a1\/u1\/[0-9a-f-]+_IMG_1\.png$/);
    expect(JSON.stringify(j)).not.toContain('secret');
  });
});

describe('POST /sign (unduh)', () => {
  const path = 'submissions/w1/a1/u1/f.png';
  it('200 untuk siswa yang sama di perangkat lain (uid beda, studentId sama)', async () => {
    fetchMock.mockImplementation(async () => Response.json({ signedURL: '/object/sign/submission-attachments/x?token=T' }));
    docs['student_profiles/u1'] = { workspaceId: 'w1', className: '7A', studentId: 's1' };
    docs['student_profiles/u2'] = { workspaceId: 'w1', className: '7A', studentId: 's1' };
    verifyIdToken.mockResolvedValue({ uid: 'u2' });
    expect((await sign(req('/s', { filePath: path }))).status).toBe(200);
  });
  it('403 untuk siswa lain', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u2' });
    docs['student_profiles/u2'] = { workspaceId: 'w1', className: '7A', studentId: 's2' };
    expect((await sign(req('/s', { filePath: path }))).status).toBe(403);
  });
  it('200 untuk pemilik dan guru workspace', async () => {
    fetchMock.mockImplementation(async () => Response.json({ signedURL: '/object/sign/submission-attachments/x?token=T' }));
    expect((await sign(req('/s', { filePath: path }))).status).toBe(200);
    verifyIdToken.mockResolvedValue({ uid: 't1' });
    expect((await sign(req('/s', { filePath: path }))).status).toBe(200);
  });
  it('401 tanpa token', async () => {
    expect((await sign(req('/s', { filePath: path }, null))).status).toBe(401);
  });
});
