import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FREE_CLASS_LIMIT, getEffectiveClassLimit, isPlanExpired } from '../lib/config/plans';

// Unit test dengan Admin SDK di-mock (bukan Firestore sungguhan): menguji
// penegakan batas kelas + masa berlaku paket di jalur satu-satunya pembuatan siswa.

const verifyIdToken = vi.fn();
const store: Record<string, Record<string, any>> = {};
const created: { path: string; data: any }[] = [];
let idSeq = 0;

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__SERVER_TS__' } }));
vi.mock('@/lib/server/firebaseAdmin', () => {
  const docRef = (c: string, id: string) => ({
    path: `${c}/${id}`, id, _kind: 'doc',
    get: async () => snap(`${c}/${id}`),
  });
  const snap = (path: string) => ({
    id: path.split('/')[1], exists: path in store, data: () => store[path],
    get: (f: string) => store[path]?.[f],
  });
  const query = (c: string, filters: [string, any][]) => ({
    _kind: 'query', c, filters,
    select() { return this; },
  });
  const db = {
    collection: (c: string) => ({
      doc: (id?: string) => docRef(c, id ?? `auto${++idSeq}`),
      where: (f: string, _o: string, v: any) => query(c, [[f, v]]),
    }),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (t: any) => {
          if (t._kind === 'doc') return snap(t.path);
          const docs = Object.entries(store)
            .filter(([k, v]) => k.startsWith(`${t.c}/`) && t.filters.every(([f, val]: [string, any]) => v[f] === val))
            .map(([k]) => snap(k));
          return { docs };
        },
        create: (ref: any, data: any) => {
          if (ref.path in store) throw new Error('ALREADY_EXISTS');
          created.push({ path: ref.path, data });
        },
      };
      const out = await fn(tx);
      created.forEach((c) => (store[c.path] = c.data)); // commit hanya bila fn sukses
      return out;
    },
  };
  return { getAdminAuth: () => ({ verifyIdToken }), getAdminDb: () => db };
});

import { POST } from '../app/api/students/create/route';

const req = (body: unknown, token: string | null = 'tok') =>
  new NextRequest('http://localhost/api/students/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

function seedClasses(ws: string, names: string[]) {
  names.forEach((c, i) => (store[`students/seed-${ws}-${i}`] = { workspaceId: ws, className: c }));
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  created.length = 0;
  verifyIdToken.mockReset().mockResolvedValue({ uid: 'teacher1' });
  store['teacher_profiles/teacher1'] = { workspaceId: 'w1', role: 'TEACHER' };
  store['workspaces/w1'] = { plan: 'individual_lifetime', classLimit: 3, ownerUid: 'owner' };
});

describe('plans — getEffectiveClassLimit', () => {
  it('paket aktif memakai classLimit-nya; null = tak terbatas', () => {
    expect(getEffectiveClassLimit({ classLimit: 6 }, 1000)).toBe(6);
    expect(getEffectiveClassLimit({ classLimit: null, planExpiresAt: 5000 }, 1000)).toBeNull();
  });
  it('paket kedaluwarsa turun ke batas gratis (min dengan classLimit)', () => {
    expect(isPlanExpired({ planExpiresAt: 999 }, 1000)).toBe(true);
    expect(getEffectiveClassLimit({ classLimit: null, planExpiresAt: 999 }, 1000)).toBe(FREE_CLASS_LIMIT);
    expect(getEffectiveClassLimit({ classLimit: 2, planExpiresAt: 999 }, 1000)).toBe(2);
    expect(getEffectiveClassLimit({ classLimit: 6, planExpiresAt: null }, 1000)).toBe(6);
  });
});

describe('POST /api/students/create', () => {
  it('401 tanpa token atau token tidak valid', async () => {
    expect((await POST(req({}, null))).status).toBe(401);
    verifyIdToken.mockRejectedValue(new Error('bad'));
    expect((await POST(req({ students: [] }))).status).toBe(401);
  });

  it('403 untuk akun tanpa workspace (mis. akun siswa)', async () => {
    delete store['teacher_profiles/teacher1'];
    const res = await POST(req({ students: [{ name: 'A', className: '7A' }] }));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it('workspaceId dari profil server, bukan dari body; mengisi createdBy/createdAt server + kode akses', async () => {
    const res = await POST(req({ workspaceId: 'w-lain', students: [{ name: ' Budi ', nis: '1', className: ' 7a ' }] }));
    expect(res.status).toBe(200);
    const student = created.find((c) => c.path.startsWith('students/'))!.data;
    expect(student).toMatchObject({ workspaceId: 'w1', name: 'Budi', className: '7A', createdBy: 'teacher1', createdAt: '__SERVER_TS__' });
    const code = created.find((c) => c.path.startsWith('student_login_codes/'))!;
    expect(code.data).toMatchObject({ workspaceId: 'w1', className: '7A', name: 'Budi' });
    expect(code.path).toBe(`student_login_codes/${student.accessCode}`);
  });

  it('menolak kelas baru ketika batas kelas paket tercapai (403), tanpa menulis apa pun', async () => {
    seedClasses('w1', ['7A', '7B', '7C']);
    const res = await POST(req({ students: [{ name: 'A', className: '7D' }] }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/maksimal 3 kelas/);
    expect(created).toHaveLength(0);
  });

  it('menambah siswa ke kelas yang SUDAH ada tetap boleh di batas (case-insensitive)', async () => {
    seedClasses('w1', ['7A', '7B', '7C']);
    expect((await POST(req({ students: [{ name: 'A', className: '7b' }] }))).status).toBe(200);
  });

  it('menghitung SEMUA kelas baru dalam satu permintaan terhadap batas', async () => {
    seedClasses('w1', ['7A', '7B']);
    const res = await POST(req({ students: [{ name: 'A', className: '7C' }, { name: 'B', className: '7D' }] }));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it('kelas dari workspace lain tidak ikut dihitung', async () => {
    seedClasses('w-lain', ['1', '2', '3', '4']);
    expect((await POST(req({ students: [{ name: 'A', className: '7A' }] }))).status).toBe(200);
  });

  it('paket kedaluwarsa: unlimited jatuh ke batas gratis untuk kelas baru, kelas lama tetap boleh', async () => {
    store['workspaces/w1'] = { plan: 'individual_monthly', classLimit: null, planExpiresAt: Date.now() - 1000 };
    seedClasses('w1', ['7A', '7B', '7C', '7D']);
    expect((await POST(req({ students: [{ name: 'A', className: '7E' }] }))).status).toBe(403);
    expect((await POST(req({ students: [{ name: 'A', className: '7D' }] }))).status).toBe(200);
  });

  it('paket aktif tak terbatas tidak dibatasi', async () => {
    store['workspaces/w1'] = { plan: 'individual_monthly', classLimit: null, planExpiresAt: Date.now() + 86_400_000 };
    seedClasses('w1', ['1', '2', '3', '4', '5']);
    expect((await POST(req({ students: [{ name: 'A', className: '9Z' }] }))).status).toBe(200);
  });

  it('400 untuk input tidak valid (kosong, nama kosong, terlalu banyak)', async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ students: [{ name: '', className: '7A' }] }))).status).toBe(400);
    expect((await POST(req({ students: [{ name: 'A', className: '' }] }))).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ name: `S${i}`, className: '7A' }));
    expect((await POST(req({ students: many }))).status).toBe(400);
  });
});
