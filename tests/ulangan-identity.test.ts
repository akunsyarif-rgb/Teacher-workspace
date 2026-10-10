import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncUlanganIdentity, type Doc, type IdentitySink, type IdentitySources } from '../lib/server/ulanganIdentitySync';

// Proyeksi identitas Ulangan Harian dengan Firestore & Supabase PALSU (tanpa jaringan). Membuktikan: uid hanya dari pemanggil,
// peran/kelas dari dokumen Firestore, siswa dicocokkan dengan dokumen students, fail-closed (cabut) bila tidak valid.
function fakes(docs: Record<string, Doc>, students: { id: string; className: string; name: string }[] = []) {
  const calls: { op: 'upsert' | 'remove'; table: string; rows?: Doc[]; filter?: string; onConflict?: string }[] = [];
  const src: IdentitySources = {
    getDoc: async (c, id) => docs[`${c}/${id}`] ?? null,
    listStudents: async () => students,
  };
  const sink: IdentitySink = {
    upsert: async (table, rows, onConflict) => { calls.push({ op: 'upsert', table, rows, onConflict }); },
    remove: async (table, filter) => { calls.push({ op: 'remove', table, filter }); },
  };
  return { src, sink, calls };
}
const NOW = () => new Date('2026-10-10T10:00:00.000Z');

describe('sinkronisasi identitas guru', () => {
  it('guru valid → ulh_members (peran dari Firestore), tanpa roster bila tidak diminta', async () => {
    const f = fakes({ 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'ADMIN', name: 'Bu Ani' } });
    expect(await syncUlanganIdentity({ uid: 'u1', now: NOW }, f.src, f.sink)).toEqual({ kind: 'teacher' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ op: 'upsert', table: 'ulh_members', onConflict: 'user_id' });
    expect(f.calls[0].rows?.[0]).toEqual({
      user_id: 'u1', kind: 'teacher', workspace_id: 'wsA', role: 'ADMIN', student_id: null, class_name: null, name: 'Bu Ani', synced_at: '2026-10-10T10:00:00.000Z',
    });
  });
  it('roster: upsert per chunk lalu hapus yang basi HANYA setelah semua upsert sukses', async () => {
    const students = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, className: '7A', name: `N${i}` }));
    const f = fakes({ 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'OWNER' } }, [...students, { id: 'x', className: '', name: 'tanpa kelas' }]);
    const r = await syncUlanganIdentity({ uid: 'u1', roster: true, now: NOW }, f.src, f.sink);
    expect(r.rosterCount).toBe(1000);
    const ups = f.calls.filter((c) => c.table === 'ulh_roster' && c.op === 'upsert');
    expect(ups.map((c) => c.rows?.length)).toEqual([400, 400, 200]);
    expect(f.calls.at(-1)).toEqual({ op: 'remove', table: 'ulh_roster', filter: 'workspace_id=eq.wsA&synced_at=lt.2026-10-10T10%3A00%3A00.000Z' });
    // upsert gagal di tengah → tidak ada penghapusan
    const g = fakes({ 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'OWNER' } }, students);
    let n = 0;
    g.sink.upsert = async (table) => { if (table === 'ulh_roster' && ++n === 2) throw new Error('putus'); };
    g.sink.remove = vi.fn();
    await expect(syncUlanganIdentity({ uid: 'u1', roster: true, now: NOW }, g.src, g.sink)).rejects.toThrow('putus');
    expect(g.sink.remove).not.toHaveBeenCalled();
  });
  it('peran/workspace tidak valid atau nonaktif → bukan guru (dicabut)', async () => {
    for (const doc of [{ workspaceId: 'wsA', role: 'SUPERADMIN' }, { workspaceId: '', role: 'OWNER' }, { workspaceId: 'wsA', role: 'OWNER', isActive: false }, { role: 'OWNER' }]) {
      const f = fakes({ 'teacher_profiles/u1': doc });
      expect(await syncUlanganIdentity({ uid: 'u1', now: NOW }, f.src, f.sink)).toEqual({ kind: null });
      expect(f.calls).toEqual([{ op: 'remove', table: 'ulh_members', filter: 'user_id=eq.u1' }]);
    }
  });
  it('uid kosong ditolak; uid di-encode pada filter', async () => {
    const f = fakes({});
    await expect(syncUlanganIdentity({ uid: '' }, f.src, f.sink)).rejects.toThrow();
    await syncUlanganIdentity({ uid: 'a&b=c' }, f.src, f.sink);
    expect(f.calls[0].filter).toBe('user_id=eq.a%26b%3Dc');
  });
});

describe('sinkronisasi identitas siswa', () => {
  const profile = { studentId: 's1', workspaceId: 'wsA', className: '7A', name: 'Budi' };
  it('profil cocok dengan dokumen students → ulh_members siswa', async () => {
    const f = fakes({ 'student_profiles/u2': profile, 'students/s1': { workspaceId: 'wsA', className: '7A', name: 'Budi S.' } });
    expect(await syncUlanganIdentity({ uid: 'u2', roster: true, now: NOW }, f.src, f.sink)).toEqual({ kind: 'student' });
    expect(f.calls).toHaveLength(1); // siswa tidak pernah menyinkronkan roster
    expect(f.calls[0].rows?.[0]).toEqual({
      user_id: 'u2', kind: 'student', workspace_id: 'wsA', role: null, student_id: 's1', class_name: '7A', name: 'Budi S.', synced_at: '2026-10-10T10:00:00.000Z',
    });
  });
  it('profil tidak cocok (workspace/kelas beda, siswa tak ada) → dicabut', async () => {
    for (const student of [{ workspaceId: 'wsB', className: '7A' }, { workspaceId: 'wsA', className: '7B' }, null]) {
      const f = fakes({ 'student_profiles/u2': profile, ...(student ? { 'students/s1': student } : {}) });
      expect(await syncUlanganIdentity({ uid: 'u2', now: NOW }, f.src, f.sink)).toEqual({ kind: null });
      expect(f.calls).toEqual([{ op: 'remove', table: 'ulh_members', filter: 'user_id=eq.u2' }]);
    }
  });
  it('guru menang atas profil siswa; tanpa profil apa pun → dicabut', async () => {
    const both = fakes({ 'teacher_profiles/u3': { workspaceId: 'wsA', role: 'TEACHER' }, 'student_profiles/u3': profile, 'students/s1': { workspaceId: 'wsA', className: '7A' } });
    expect((await syncUlanganIdentity({ uid: 'u3', now: NOW }, both.src, both.sink)).kind).toBe('teacher');
    expect(both.calls[0].rows?.[0]).toMatchObject({ kind: 'teacher', student_id: null }); // baris siswa lama tertimpa bersih
    const none = fakes({});
    expect(await syncUlanganIdentity({ uid: 'zz', now: NOW }, none.src, none.sink)).toEqual({ kind: null });
  });
});

// ---------- Route handler ----------
const verifyIdToken = vi.fn();
const serviceRequest = vi.fn();
const docGet = vi.fn();
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminDb: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({ get: async () => docGet(c, id) }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
  }),
}));
vi.mock('@/lib/server/supabaseServer', () => ({ serviceRequest: (...a: unknown[]) => serviceRequest(...a) }));

describe('POST /api/ulangan/sync-identity', () => {
  const req = (headers: Record<string, string> = {}, body: unknown = {}) =>
    new Request('http://x/api/ulangan/sync-identity', { method: 'POST', headers, body: JSON.stringify(body) }) as never;
  beforeEach(() => { verifyIdToken.mockReset(); serviceRequest.mockReset().mockResolvedValue(null); docGet.mockReset(); delete process.env.ENABLE_ULANGAN_IDENTITY_SYNC; });

  it('default mati (501) tanpa menyentuh Firebase/Supabase', async () => {
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    const res = await POST(req({ authorization: 'Bearer t' }));
    expect(res.status).toBe(501);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(serviceRequest).not.toHaveBeenCalled();
  });
  it('tanpa token 401; token tidak valid 401', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    expect((await POST(req())).status).toBe(401);
    verifyIdToken.mockRejectedValue(new Error('revoked'));
    expect((await POST(req({ authorization: 'Bearer bad' }))).status).toBe(401);
    expect(verifyIdToken).toHaveBeenCalledWith('bad', true);
    expect(serviceRequest).not.toHaveBeenCalled();
  });
  it('uid hanya dari token (body user_id/uid diabaikan); menulis lewat service role', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    verifyIdToken.mockResolvedValue({ uid: 'real-uid' });
    docGet.mockImplementation(async (c: string, id: string) =>
      c === 'teacher_profiles' && id === 'real-uid' ? { exists: true, data: () => ({ workspaceId: 'wsA', role: 'TEACHER' }) } : { exists: false, data: () => undefined });
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    const res = await POST(req({ authorization: 'Bearer ok' }, { uid: 'victim', user_id: 'victim', role: 'OWNER', workspaceId: 'wsZ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: 'teacher' });
    expect(serviceRequest).toHaveBeenCalledTimes(1);
    const [path, init] = serviceRequest.mock.calls[0];
    expect(path).toBe('ulh_members?on_conflict=user_id');
    const row = JSON.parse(init.body)[0];
    expect(row).toMatchObject({ user_id: 'real-uid', workspace_id: 'wsA', role: 'TEACHER' });
    expect(JSON.stringify(row)).not.toMatch(/victim|wsZ|OWNER/);
  });
  it('kegagalan Supabase → 502 generik tanpa bocor detail', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    verifyIdToken.mockResolvedValue({ uid: 'u' });
    docGet.mockResolvedValue({ exists: false, data: () => undefined });
    serviceRequest.mockRejectedValue(new Error('SECRET connection string'));
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    const res = await POST(req({ authorization: 'Bearer ok' }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/SECRET/);
  });
});

// ---------- Klien & controller ----------
describe('klien sinkronisasi & withIdentity', () => {
  it('klien hanya mengirim token + {roster}; galat HTTP → IdentitySyncError', async () => {
    const { syncUlanganIdentity: client, IdentitySyncError } = await import('../lib/adapters/ulanganIdentityClient');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, kind: 'student' }), { status: 200 }));
    expect(await client(false, { getToken: async () => 'tok', fetchImpl: fetchImpl as never })).toEqual({ kind: 'student' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/ulangan/sync-identity');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ roster: false });
    await expect(client(true, { getToken: async () => 'tok', fetchImpl: (async () => new Response('', { status: 501 })) as never })).rejects.toBeInstanceOf(IdentitySyncError);
    await expect(client(true, { getToken: async () => null })).rejects.toThrow(/belum login/);
  });
  it('withIdentity: sinkronkan lalu ulangi SEKALI hanya untuk galat identitas/roster basi', async () => {
    vi.doMock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => ({ rpc: vi.fn() }) }));
    const { withIdentity } = await import('../lib/controllers/ulanganController');
    const sync = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValueOnce(new Error('Supabase 403 42501: not_a_teacher')).mockResolvedValue('ok');
    expect(await withIdentity(fn, sync)).toBe('ok');
    expect(sync).toHaveBeenCalledWith(true);
    const s2 = vi.fn().mockResolvedValue(undefined);
    const f2 = vi.fn().mockRejectedValueOnce(new Error('P0001: class_not_found')).mockResolvedValue(1);
    expect(await withIdentity(f2, s2)).toBe(1);
    expect(s2).toHaveBeenCalledWith(true);
    const s3 = vi.fn().mockResolvedValue(undefined);
    const f3 = vi.fn().mockRejectedValueOnce(new Error('not_a_student')).mockResolvedValue(2);
    await withIdentity(f3, s3);
    expect(s3).toHaveBeenCalledWith(false);
    // tetap ditolak setelah sinkronisasi → galat muncul (tidak berulang tanpa batas)
    const f4 = vi.fn().mockRejectedValue(new Error('not_a_teacher'));
    await expect(withIdentity(f4, vi.fn().mockResolvedValue(undefined))).rejects.toThrow('not_a_teacher');
    expect(f4).toHaveBeenCalledTimes(2);
    // galat lain tidak memicu sinkronisasi
    const s5 = vi.fn();
    await expect(withIdentity(vi.fn().mockRejectedValue(new Error('attempt_expired')), s5)).rejects.toThrow('attempt_expired');
    expect(s5).not.toHaveBeenCalled();
  });
});
