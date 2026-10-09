import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Unit test dengan Admin SDK di-mock — bukan uji Firestore sungguhan.

const verifyIdToken = vi.fn();
const getUsers = vi.fn();
const updates: { path: string; data: Record<string, unknown> }[] = [];
const docs: Record<string, Record<string, unknown>> = {};

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => '__DELETE__' } }));
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken, getUsers }),
  getAdminDb: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ id, exists: docs[`${c}/${id}`] !== undefined, data: () => docs[`${c}/${id}`] }),
        update: async (data: Record<string, unknown>) => {
          updates.push({ path: `${c}/${id}`, data });
        },
      }),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: Object.entries(docs)
            .filter(([k, v]) => k.startsWith(`${c}/`) && v[field] === value)
            .map(([k, v]) => ({ id: k.split('/')[1], data: () => v })),
        }),
      }),
    }),
  }),
}));

import { GET, DELETE } from '../app/api/workspace/members/route';

function req(method: string, body?: unknown, token: string | null = 'tok') {
  return new NextRequest('http://localhost/api/workspace/members', {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  updates.length = 0;
  for (const k of Object.keys(docs)) delete docs[k];
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'owner' });
  getUsers.mockReset().mockResolvedValue({ users: [{ uid: 'owner', email: 'o@x.id' }, { uid: 't1', email: 't1@x.id' }] });
  docs['workspaces/w1'] = { ownerUid: 'owner', plan: 'school_annual', seatLimit: 5 };
  docs['teacher_profiles/owner'] = { workspaceId: 'w1', role: 'OWNER', name: 'Pemilik', subject: 'IPA', quickNote: 'rahasia' };
  docs['teacher_profiles/t1'] = { workspaceId: 'w1', role: 'TEACHER', name: 'Budi', subject: 'MTK', homeroomClassName: '7A' };
  docs['teacher_profiles/other'] = { workspaceId: 'w2', role: 'TEACHER', name: 'Luar' };
});

describe('GET /api/workspace/members', () => {
  it('401 tanpa token / token tidak valid', async () => {
    expect((await GET(req('GET', undefined, null))).status).toBe(401);
    verifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await GET(req('GET'))).status).toBe(401);
  });
  it('403 untuk guru biasa dan untuk ADMIN', async () => {
    verifyIdToken.mockResolvedValue({ uid: 't1' });
    expect((await GET(req('GET'))).status).toBe(403);
    docs['teacher_profiles/t1'].role = 'ADMIN';
    expect((await GET(req('GET'))).status).toBe(403);
  });
  it('403 bila role OWNER tapi bukan ownerUid workspace', async () => {
    docs['workspaces/w1'].ownerUid = 'seseorang-lain';
    expect((await GET(req('GET'))).status).toBe(403);
  });
  it('OWNER dapat daftar guru workspace-nya saja, tanpa quickNote, dengan email', async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.seatLimit).toBe(5);
    expect(j.members.map((m: { uid: string }) => m.uid)).toEqual(['owner', 't1']);
    expect(j.members[0]).toMatchObject({ isYou: true, role: 'OWNER', email: 'o@x.id' });
    expect(JSON.stringify(j)).not.toContain('rahasia');
    expect(JSON.stringify(j)).not.toContain('Luar');
  });
});

describe('DELETE /api/workspace/members', () => {
  it('guru biasa tidak boleh mengeluarkan siapa pun', async () => {
    verifyIdToken.mockResolvedValue({ uid: 't1' });
    expect((await DELETE(req('DELETE', { uid: 'owner' }))).status).toBe(403);
    expect(updates).toHaveLength(0);
  });
  it('OWNER tidak bisa mengeluarkan diri sendiri', async () => {
    expect((await DELETE(req('DELETE', { uid: 'owner' }))).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
  it('tidak bisa mengeluarkan guru dari workspace lain (404)', async () => {
    expect((await DELETE(req('DELETE', { uid: 'other' }))).status).toBe(404);
    expect(updates).toHaveLength(0);
  });
  it('tidak bisa mengeluarkan OWNER lain', async () => {
    docs['teacher_profiles/t1'].role = 'OWNER';
    expect((await DELETE(req('DELETE', { uid: 't1' }))).status).toBe(400);
  });
  it('uid kosong -> 400', async () => {
    expect((await DELETE(req('DELETE', {}))).status).toBe(400);
  });
  it('OWNER mengeluarkan guru: workspaceId/role/homeroom dilepas, akun tidak dihapus', async () => {
    const res = await DELETE(req('DELETE', { uid: 't1' }));
    expect(res.status).toBe(200);
    expect(updates).toEqual([
      { path: 'teacher_profiles/t1', data: { workspaceId: '__DELETE__', role: '__DELETE__', homeroomClassName: '__DELETE__' } },
    ]);
  });
});
