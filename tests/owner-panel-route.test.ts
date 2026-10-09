import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Unit test dengan Admin SDK di-mock — bukan uji Firestore sungguhan.

const verifyIdToken = vi.fn();
const updates: { path: string; data: Record<string, unknown> }[] = [];
const docs: Record<string, Record<string, unknown>> = {};

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__TS__' } }));
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminDb: () => ({
    collection: (c: string) => ({
      limit: () => ({
        get: async () => ({
          docs: Object.entries(docs).filter(([k]) => k.startsWith(`${c}/`)).map(([k, v]) => ({ id: k.split('/')[1], data: () => v })),
        }),
      }),
      where: (field: string, _op: string, value: unknown) => ({
        count: () => ({
          get: async () => ({ data: () => ({ count: Object.entries(docs).filter(([k, v]) => k.startsWith(`${c}/`) && v[field] === value).length }) }),
        }),
      }),
      doc: (id: string) => ({
        get: async () => ({ exists: docs[`${c}/${id}`] !== undefined, data: () => docs[`${c}/${id}`] }),
        update: async (data: Record<string, unknown>) => {
          updates.push({ path: `${c}/${id}`, data });
        },
      }),
    }),
  }),
}));

import { GET, PATCH } from '../app/api/owner/workspaces/route';

function req(method: string, body?: unknown, token: string | null = 'tok') {
  return new NextRequest('http://localhost/api/owner/workspaces', {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  updates.length = 0;
  for (const k of Object.keys(docs)) delete docs[k];
  process.env.APP_OWNER_UIDS = ' ownerA , ownerB ';
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'ownerA' });
  docs['workspaces/w1'] = { name: 'SH', plan: 'individual_lifetime', classLimit: 12, ownerUid: 'u1' };
  docs['teacher_profiles/u1'] = { workspaceId: 'w1' };
});

describe('GET /api/owner/workspaces', () => {
  it('401 tanpa token / token tidak valid', async () => {
    expect((await GET(req('GET', undefined, null))).status).toBe(401);
    verifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await GET(req('GET'))).status).toBe(401);
  });
  it('403 untuk uid yang tidak ada di APP_OWNER_UIDS', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'ownerOfWorkspace' });
    expect((await GET(req('GET'))).status).toBe(403);
  });
  it('403 untuk semua orang bila APP_OWNER_UIDS kosong atau tidak ada (fail closed)', async () => {
    process.env.APP_OWNER_UIDS = '';
    expect((await GET(req('GET'))).status).toBe(403);
    delete process.env.APP_OWNER_UIDS;
    expect((await GET(req('GET'))).status).toBe(403);
  });
  it('pemilik aplikasi dapat daftar workspace + jumlah guru', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.workspaces).toEqual([
      { id: 'w1', name: 'SH', plan: 'individual_lifetime', seatLimit: null, classLimit: 12, planExpiresAt: null, ownerUid: 'u1', memberCount: 1 },
    ]);
  });
});

describe('PATCH /api/owner/workspaces', () => {
  it('403 untuk bukan pemilik aplikasi dan tidak ada yang ditulis', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'ownerOfWorkspace' });
    expect((await PATCH(req('PATCH', { workspaceId: 'w1', plan: 'school_annual' }))).status).toBe(403);
    expect(updates).toHaveLength(0);
  });
  it('menyimpan plan + seatLimit + classLimit dengan updatedAt dari server', async () => {
    const res = await PATCH(req('PATCH', { workspaceId: 'w1', plan: 'school_annual', seatLimit: 10, classLimit: null }));
    expect(res.status).toBe(200);
    expect(updates).toEqual([
      { path: 'workspaces/w1', data: { plan: 'school_annual', seatLimit: 10, classLimit: null, updatedAt: '__TS__' } },
    ]);
  });
  it('hanya field yang dikirim yang diubah', async () => {
    await PATCH(req('PATCH', { workspaceId: 'w1', seatLimit: 3 }));
    expect(Object.keys(updates[0].data).sort()).toEqual(['seatLimit', 'updatedAt']);
  });
  it('menolak plan tak dikenal, angka tidak valid, dan tanpa perubahan', async () => {
    expect((await PATCH(req('PATCH', { workspaceId: 'w1', plan: 'gratis_selamanya' }))).status).toBe(400);
    expect((await PATCH(req('PATCH', { workspaceId: 'w1', seatLimit: -1 }))).status).toBe(400);
    expect((await PATCH(req('PATCH', { workspaceId: 'w1', seatLimit: 2.5 }))).status).toBe(400);
    expect((await PATCH(req('PATCH', { workspaceId: 'w1', classLimit: '10' }))).status).toBe(400);
    expect((await PATCH(req('PATCH', { workspaceId: 'w1' }))).status).toBe(400);
    expect((await PATCH(req('PATCH', { plan: 'school_annual' }))).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
  it('404 untuk workspace yang tidak ada', async () => {
    expect((await PATCH(req('PATCH', { workspaceId: 'nope', plan: 'school_annual' }))).status).toBe(404);
  });
});
