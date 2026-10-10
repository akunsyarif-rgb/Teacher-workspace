import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Modul server identitas/akses sekolah di jalur Supabase: join kode undangan, Menu Admin (daftar/keluarkan guru),
// Panel Pemilik Aplikasi, pembayaran dinonaktifkan. Firebase Admin & fetch dipalsukan; tidak ada jaringan.
const admin = vi.hoisted(() => ({
  getUsers: vi.fn(async (ids: { uid: string }[]) => ({ users: ids.map((i) => ({ uid: i.uid, email: `${i.uid}@sekolah.id` })) })),
  dbUsed: vi.fn(),
}));
vi.mock('../lib/server/firebaseAdmin', () => ({
  getAdminAuth: () => ({ getUsers: admin.getUsers, verifyIdToken: vi.fn() }),
  getAdminDb: () => { admin.dbUsed(); throw new Error('Firestore Admin TIDAK boleh dipakai pada jalur Supabase'); },
}));

const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
type Call = { url: string; method: string; auth: string; apikey: string; body?: unknown };
let calls: Call[] = [];
let handler: (c: Call) => { status?: number; body?: unknown } = () => ({ body: [] });

function setEnv(opts: { on?: boolean; url?: string } = {}) {
  const on = opts.on ?? true;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', on ? 'workspaces,teacher_profiles' : '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED', on ? 'yes' : '');
  vi.stubEnv('SUPABASE_URL', opts.url ?? URL_OK);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test');
  vi.stubEnv('APP_OWNER_UIDS', 'appOwner1');
}

beforeEach(() => {
  calls = [];
  handler = () => ({ body: [] });
  admin.getUsers.mockClear();
  admin.dbUsed.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    const c: Call = { url: String(url), method: init.method ?? 'GET', auth: h.Authorization ?? '', apikey: h.apikey ?? '', body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = handler(c);
    const status = r.status ?? 200;
    return { ok: status < 400, status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

const WS_ROW = { id: 'ws1', name: 'SMA 1', plan: 'school_annual', owner_uid: 'owner1', class_limit: 3, seat_limit: 5, invite_code: 'ABC234', invite_code_expires_at: 9999999999999 };
const path = (c: Call) => c.url.replace(`${URL_OK}/rest/v1/`, '');

describe('join kode undangan (RPC join_workspace_by_code, token pengguna)', () => {
  const load = async () => { setEnv(); return (await import('../lib/server/workspaceAdminService')).joinWorkspaceByCodeServer; };
  it('berhasil: RPC dipanggil dengan token PENGGUNA (bukan secret key), lalu workspace dibaca', async () => {
    handler = (c) => (path(c).startsWith('rpc/join_workspace_by_code') ? { body: [{ workspace_id: 'ws1', workspace_name: 'SMA 1', role: 'TEACHER' }] } : { body: [WS_ROW] });
    const ws = await (await load())('u1', ' abc234 ', 'ID-TOKEN-U1');
    expect(ws).toMatchObject({ id: 'ws1', name: 'SMA 1', ownerUid: 'owner1', seatLimit: 5, classLimit: 3, inviteCode: 'ABC234' });
    expect(calls[0].body).toEqual({ p_code: 'ABC234' });
    for (const c of calls) { expect(c.auth).toBe('Bearer ID-TOKEN-U1'); expect(c.apikey).toBe('sb_publishable_test'); }
    expect(admin.dbUsed).not.toHaveBeenCalled();
  });
  it.each([
    ['invalid invite code', /tidak ditemukan/],
    ['invite code expired', /kedaluwarsa/],
    ['account already belongs to a workspace', /sudah terhubung/],
    ['seat limit reached', /Kuota guru.*penuh/],
  ])('error RPC "%s" dipetakan ke pesan Indonesia', async (msg, re) => {
    handler = () => ({ status: 400, body: { code: 'P0001', message: msg } });
    await expect((await load())('u1', 'abc234', 'tok')).rejects.toThrow(re);
  });
  it('pesan kuota penuh TIDAK menyuruh membeli/upgrade (tidak ada kaitan pembayaran)', async () => {
    handler = () => ({ status: 400, body: { message: 'seat limit reached' } });
    await expect((await load())('u1', 'abc234', 'tok')).rejects.not.toThrow(/beli|upgrade|bayar/i);
  });
  it('tanpa token → ditolak sebelum request; kode kosong ditolak', async () => {
    const join = await load();
    await expect(join('u1', 'abc234', undefined)).rejects.toThrow(/Token/);
    await expect(join('u1', '   ', 'tok')).rejects.toThrow(/kode undangan/i);
    expect(calls).toHaveLength(0);
  });
});

describe('Menu Admin sekolah (pemilik)', () => {
  const load = async () => { setEnv(); return import('../lib/server/workspaceAdminService'); };
  const asOwner = (c: Call) => {
    const p = path(c);
    if (p.startsWith('teacher_profiles?user_id=eq.owner1')) return { body: [{ workspace_id: 'ws1', role: 'OWNER' }] };
    if (p.startsWith('workspaces?id=eq.ws1')) return { body: [WS_ROW] };
    if (p.startsWith('teacher_profiles?workspace_id=eq.ws1')) return { body: [
      { user_id: 'owner1', name: 'Pak Budi', role: 'OWNER', subject: 'Matematika' },
      { user_id: 'g2', name: 'Bu Ani', role: 'TEACHER', subject: 'IPA' },
      { user_id: 'g3', name: null, role: null, subject: null },
    ] };
    if (p.startsWith('rpc/remove_workspace_member')) return { body: null };
    return { status: 404, body: { message: 'x' } };
  };
  it('daftar anggota: kolom dipilih eksplisit (tanpa quickNote), email dari Firebase Auth, pemilik di atas, isYou', async () => {
    handler = asOwner;
    const { members, seatLimit } = await (await load()).listWorkspaceMembersServer('owner1', 'tok');
    expect(members.map((m) => [m.uid, m.name, m.role, m.isYou, m.email])).toEqual([
      ['owner1', 'Pak Budi', 'OWNER', true, 'owner1@sekolah.id'],
      ['g3', 'Tanpa nama', 'TEACHER', false, 'g3@sekolah.id'],
      ['g2', 'Bu Ani', 'TEACHER', false, 'g2@sekolah.id'],
    ].sort((a, b) => (a[2] === 'OWNER' ? -1 : b[2] === 'OWNER' ? 1 : String(a[1]).localeCompare(String(b[1])))));
    expect(seatLimit).toBe(5);
    const listCall = calls.find((c) => path(c).startsWith('teacher_profiles?workspace_id='))!;
    expect(path(listCall)).toContain('select=user_id,name,role,subject:metadata->>subject');
    expect(path(listCall)).not.toMatch(/quickNote|select=\*/);
    expect(admin.dbUsed).not.toHaveBeenCalled();
  });
  it('bukan pemilik (TEACHER/ADMIN atau tanpa workspace) → 403; workspace milik orang lain → 403', async () => {
    const svc = await load();
    handler = (c) => (path(c).startsWith('teacher_profiles?user_id') ? { body: [{ workspace_id: 'ws1', role: 'TEACHER' }] } : { body: [WS_ROW] });
    await expect(svc.listWorkspaceMembersServer('u9', 'tok')).rejects.toMatchObject({ status: 403 });
    handler = (c) => (path(c).startsWith('teacher_profiles?user_id') ? { body: [{ workspace_id: null, role: null }] } : { body: [] });
    await expect(svc.listWorkspaceMembersServer('u9', 'tok')).rejects.toMatchObject({ status: 403 });
    handler = (c) => (path(c).startsWith('teacher_profiles?user_id') ? { body: [{ workspace_id: 'ws1', role: 'OWNER' }] } : { body: [{ ...WS_ROW, owner_uid: 'orangLain' }] });
    await expect(svc.listWorkspaceMembersServer('u9', 'tok')).rejects.toMatchObject({ status: 403 });
    await expect(svc.listWorkspaceMembersServer('u9', undefined)).rejects.toMatchObject({ status: 401 });
  });
  it('keluarkan guru: RPC remove_workspace_member dengan token pemilik; error dipetakan ke status HTTP', async () => {
    const svc = await load();
    handler = asOwner;
    await svc.removeWorkspaceMemberServer('owner1', 'g2', 'tok');
    expect(calls.find((c) => path(c).startsWith('rpc/remove_workspace_member'))!.body).toEqual({ p_target: 'g2' });
    for (const c of calls) expect(c.auth).toBe('Bearer tok');
    for (const [msg, status] of [['owner cannot remove self', 400], ['workspace owner cannot be removed', 400], ['member not found', 404], ['only the workspace owner may remove members', 403]] as const) {
      handler = (c) => (path(c).startsWith('rpc/') ? { status: 400, body: { message: msg } } : asOwner(c));
      await expect(svc.removeWorkspaceMemberServer('owner1', 'g2', 'tok')).rejects.toMatchObject({ status });
    }
    handler = asOwner;
    await expect(svc.removeWorkspaceMemberServer('owner1', '', 'tok')).rejects.toMatchObject({ status: 400 });
  });
});

describe('Panel Pemilik Aplikasi (service_role, lintas workspace)', () => {
  const load = async () => { setEnv(); return import('../lib/server/ownerAdminService'); };
  it('bukan pemilik aplikasi → 403 TANPA request apa pun ke Supabase', async () => {
    const svc = await load();
    await expect(svc.listWorkspacesForOwnerServer('guruBiasa')).rejects.toMatchObject({ status: 403 });
    await expect(svc.updateWorkspaceForOwnerServer('guruBiasa', 'ws1', { seatLimit: 50 })).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(0);
  });
  it('daftar workspace + jumlah anggota dihitung; memakai secret key', async () => {
    handler = (c) => (path(c).startsWith('workspaces') ? { body: [WS_ROW, { ...WS_ROW, id: 'ws2', seat_limit: null }] } : { body: [{ workspace_id: 'ws1' }, { workspace_id: 'ws1' }, { workspace_id: 'ws2' }] });
    const rows = await (await load()).listWorkspacesForOwnerServer('appOwner1');
    expect(rows.map((r) => [r.id, r.memberCount, r.seatLimit])).toEqual([['ws1', 2, 5], ['ws2', 1, null]]);
    for (const c of calls) expect(c.auth).toBe('Bearer sb_secret_test');
    expect(admin.dbUsed).not.toHaveBeenCalled();
  });
  it('ubah kuota guru/kelas: field dipetakan snake_case, validasi tetap, 404 bila workspace tak ada', async () => {
    const svc = await load();
    handler = () => ({ body: [{ id: 'ws1' }] });
    await svc.updateWorkspaceForOwnerServer('appOwner1', 'ws1', { seatLimit: 40, classLimit: null });
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { seat_limit: 40, class_limit: null } });
    await expect(svc.updateWorkspaceForOwnerServer('appOwner1', 'ws1', { seatLimit: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateWorkspaceForOwnerServer('appOwner1', 'ws1', { plan: 'gratis-selamanya' })).rejects.toMatchObject({ status: 400 });
    handler = () => ({ body: [] });
    await expect(svc.updateWorkspaceForOwnerServer('appOwner1', 'tidakAda', { seatLimit: 3 })).rejects.toMatchObject({ status: 404 });
  });
});

describe('guard konfigurasi server', () => {
  it('project SmadaExam selalu ditolak untuk mode pengguna maupun service_role', async () => {
    setEnv({ url: 'https://abdkrhmxfpcmgzsxzfyz.supabase.co' });
    const s = await import('../lib/server/supabaseServer');
    await expect(s.userRequest('tok', 'teacher_profiles')).rejects.toMatchObject({ status: 503 });
    await expect(s.serviceRequest('workspaces')).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
  it('tanpa token/kunci → error konfigurasi, tanpa request; identityOnSupabase mati secara default', async () => {
    setEnv({ on: false });
    const s = await import('../lib/server/supabaseServer');
    expect(s.identityOnSupabase()).toBe(false);
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    await expect(s.serviceRequest('workspaces')).rejects.toMatchObject({ status: 503 });
    await expect(s.userRequest('', 'workspaces')).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
});

describe('pembayaran: di luar scope, dinonaktifkan hanya saat identitas di Supabase', () => {
  it('create-transaction & webhook membalas 501 TANPA menyentuh Firestore/Midtrans; default (Firestore) tidak berubah', async () => {
    setEnv();
    const ct = await import('../app/api/payments/create-transaction/route');
    const wh = await import('../app/api/payments/webhook/route');
    const req = (url: string) => new Request(url, { method: 'POST', body: '{}' }) as unknown as import('next/server').NextRequest;
    expect((await ct.POST(req('http://x/api/payments/create-transaction'))).status).toBe(501);
    expect((await wh.POST(req('http://x/api/payments/webhook'))).status).toBe(501);
    expect(admin.dbUsed).not.toHaveBeenCalled();
    vi.resetModules();
    setEnv({ on: false });
    const ct2 = await import('../app/api/payments/create-transaction/route');
    expect((await ct2.POST(req('http://x/api/payments/create-transaction'))).status).toBe(401); // alur lama: butuh token
  });
});
