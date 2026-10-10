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
    const f = fakes({ 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'ADMIN', name: 'Bu Ani' }, 'workspaces/wsA': { ownerUid: 'pemilik' } });
    expect(await syncUlanganIdentity({ uid: 'u1', now: NOW }, f.src, f.sink)).toEqual({ kind: 'teacher' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ op: 'upsert', table: 'ulh_members', onConflict: 'user_id' });
    expect(f.calls[0].rows?.[0]).toEqual({
      user_id: 'u1', kind: 'teacher', workspace_id: 'wsA', role: 'ADMIN', student_id: null, class_name: null, name: 'Bu Ani', synced_at: '2026-10-10T10:00:00.000Z',
    });
  });
  it('roster: upsert per chunk lalu hapus yang basi HANYA setelah semua upsert sukses', async () => {
    const students = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, className: '7A', name: `N${i}` }));
    const f = fakes({ 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'OWNER' }, 'workspaces/wsA': { ownerUid: 'u1' } }, [...students, { id: 'x', className: '', name: 'tanpa kelas' }]);
    const r = await syncUlanganIdentity({ uid: 'u1', roster: true, now: NOW }, f.src, f.sink);
    expect(r.rosterCount).toBe(1000);
    const ups = f.calls.filter((c) => c.table === 'ulh_roster' && c.op === 'upsert');
    expect(ups.map((c) => c.rows?.length)).toEqual([400, 400, 200]);
    expect(f.calls.at(-1)).toEqual({ op: 'remove', table: 'ulh_roster', filter: 'workspace_id=eq.wsA&synced_at=lt.2026-10-10T10%3A00%3A00.000Z' });
    // upsert gagal di tengah → tidak ada penghapusan
    const g = fakes({ 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'OWNER' }, 'workspaces/wsA': { ownerUid: 'u1' } }, students);
    let n = 0;
    g.sink.upsert = async (table) => { if (table === 'ulh_roster' && ++n === 2) throw new Error('putus'); };
    g.sink.remove = vi.fn();
    await expect(syncUlanganIdentity({ uid: 'u1', roster: true, now: NOW }, g.src, g.sink)).rejects.toThrow('putus');
    expect(g.sink.remove).not.toHaveBeenCalled();
  });
  it('peran/workspace tidak valid atau nonaktif → bukan guru (dicabut)', async () => {
    for (const doc of [{ workspaceId: 'wsA', role: 'SUPERADMIN' }, { workspaceId: '', role: 'OWNER' }, { workspaceId: 'wsA', role: 'OWNER', isActive: false }, { role: 'OWNER' }]) {
      const f = fakes({ 'teacher_profiles/u1': doc, 'workspaces/wsA': { ownerUid: 'u1' } });
      expect(await syncUlanganIdentity({ uid: 'u1', now: NOW }, f.src, f.sink)).toEqual({ kind: null });
      expect(f.calls).toEqual([{ op: 'remove', table: 'ulh_members', filter: 'user_id=eq.u1' }]);
    }
  });
  it('pertahanan berlapis: workspace tak ada / OWNER bukan ownerUid → dicabut (walau profil Firestore mengaku)', async () => {
    for (const docs of [
      { 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'OWNER' } }, // dokumen workspace tidak ada
      { 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'OWNER' }, 'workspaces/wsA': { ownerUid: 'orangLain' } }, // mengaku OWNER workspace orang
      { 'teacher_profiles/u1': { workspaceId: 'wsA', role: 'OWNER' }, 'workspaces/wsA': {} },
    ] as Record<string, Doc>[]) {
      const f = fakes(docs);
      expect(await syncUlanganIdentity({ uid: 'u1', roster: true, now: NOW }, f.src, f.sink)).toEqual({ kind: null });
      expect(f.calls).toEqual([{ op: 'remove', table: 'ulh_members', filter: 'user_id=eq.u1' }]); // tanpa roster
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
    const both = fakes({ 'workspaces/wsA': { ownerUid: 'x' }, 'teacher_profiles/u3': { workspaceId: 'wsA', role: 'TEACHER' }, 'student_profiles/u3': profile, 'students/s1': { workspaceId: 'wsA', className: '7A' } });
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
  const exists = (data: Record<string, unknown>) => ({ exists: true, data: () => data });
  const none = { exists: false, data: () => undefined };
  beforeEach(() => {
    vi.resetModules(); // pembatas laju di route bersifat per-modul → mulai bersih tiap tes
    verifyIdToken.mockReset(); serviceRequest.mockReset().mockResolvedValue(null); docGet.mockReset(); delete process.env.ENABLE_ULANGAN_IDENTITY_SYNC;
  });

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
    expect(verifyIdToken).toHaveBeenCalledWith('bad', false);
    expect(serviceRequest).not.toHaveBeenCalled();
  });
  it('uid hanya dari token (body user_id/uid diabaikan); menulis lewat service role', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    verifyIdToken.mockResolvedValue({ uid: 'real-uid' });
    docGet.mockImplementation(async (c: string, id: string) =>
      c === 'teacher_profiles' && id === 'real-uid' ? exists({ workspaceId: 'wsA', role: 'TEACHER' }) : c === 'workspaces' && id === 'wsA' ? exists({ ownerUid: 'pemilik' }) : none);
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
  it('pembatas laju: 429 + Retry-After per uid; tidak ada panggilan jaringan/Firestore untuk permintaan yang ditolak', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    verifyIdToken.mockResolvedValue({ uid: 'spam' });
    docGet.mockResolvedValue(none);
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    expect((await POST(req({ authorization: 'Bearer ok' }))).status).toBe(200);
    const writes = serviceRequest.mock.calls.length;
    const reads = docGet.mock.calls.length;
    const revokeChecks = verifyIdToken.mock.calls.filter((c) => c[1] === true).length;
    const res = await POST(req({ authorization: 'Bearer ok' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(serviceRequest.mock.calls.length).toBe(writes);
    expect(docGet.mock.calls.length).toBe(reads);
    expect(verifyIdToken.mock.calls.filter((c) => c[1] === true).length).toBe(revokeChecks); // cek pencabutan (jaringan) tidak dijalankan
    // uid lain tidak terdampak
    verifyIdToken.mockResolvedValue({ uid: 'lain' });
    expect((await POST(req({ authorization: 'Bearer ok2' }))).status).toBe(200);
  });
  it('batas global per instance: banjir banyak akun (mis. anonim massal) dipotong 429', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    docGet.mockResolvedValue(none);
    let n = 0;
    verifyIdToken.mockImplementation(async () => ({ uid: `anon-${n++}` }));
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    const statuses: number[] = [];
    for (let i = 0; i < 260; i++) statuses.push((await POST(req({ authorization: 'Bearer t' }))).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(240);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20);
  });
  it('roster ditunda (bukan error) bila terlalu sering; identitas tetap disinkronkan', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    verifyIdToken.mockResolvedValue({ uid: 'g' });
    docGet.mockImplementation(async (c: string) => (c === 'teacher_profiles' ? exists({ workspaceId: 'wsA', role: 'TEACHER' }) : c === 'workspaces' ? exists({ ownerUid: 'p' }) : none));
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    const first = await POST(req({ authorization: 'Bearer ok' }, { roster: true }));
    expect(first.status).toBe(200);
    expect(serviceRequest.mock.calls.some((c) => String(c[0]).startsWith('ulh_roster'))).toBe(true);
  });
  it('token dicabut (cek kedua gagal) → 401 dan tidak menulis apa pun; body terlalu besar → 413', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    verifyIdToken.mockImplementation(async (_t: string, revoked: boolean) => { if (revoked) throw new Error('revoked'); return { uid: 'u' }; });
    const { POST } = await import('../app/api/ulangan/sync-identity/route');
    const res = await POST(req({ authorization: 'Bearer ok' }));
    expect(res.status).toBe(401);
    expect(docGet).not.toHaveBeenCalled();
    expect(serviceRequest).not.toHaveBeenCalled();
    expect((await POST(req({ authorization: 'Bearer ok', 'content-length': '999999' }))).status).toBe(413);
    expect((await POST(req({ authorization: 'Bearer ok' }, { pad: 'x'.repeat(2000) }))).status).toBe(413);
  });
  it('kegagalan Supabase → 502 generik tanpa bocor detail', async () => {
    process.env.ENABLE_ULANGAN_IDENTITY_SYNC = 'yes';
    verifyIdToken.mockResolvedValue({ uid: 'u' });
    docGet.mockResolvedValue(none);
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

// ---------- Pembatas, sink, pencabutan ----------
describe('pembatas laju', () => {
  it('per-kunci, global, dan memori terbatas', async () => {
    const { createLimiter } = await import('../lib/server/ulanganRateLimit');
    const c = createLimiter({ perKeyMs: 1000, globalMax: 3, windowMs: 10_000, maxKeys: 2 });
    expect(c('a', 0)).toEqual({ ok: true });
    expect(c('a', 500)).toMatchObject({ ok: false, retryAfterSec: 1 });
    expect(c('a', 1000)).toEqual({ ok: true });
    expect(c('b', 1100)).toEqual({ ok: true }); // permintaan ke-3 dalam jendela
    expect(c('c', 1200)).toMatchObject({ ok: false }); // global (3) habis
    expect(c('c', 10_001)).toEqual({ ok: true }); // jendela baru
    // memori: kunci melebihi batas tidak menumbuhkan Map tanpa batas, dan kunci baru tetap dilayani
    const m = createLimiter({ perKeyMs: 60_000, globalMax: 1e9, windowMs: 1e9, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) expect(m(`k${i}`, i)).toEqual({ ok: true });
    expect(m('k999', 1000)).toMatchObject({ ok: false }); // kunci terbaru masih diingat
  });
});

describe('sink service_role: hanya ulh_members/ulh_roster', () => {
  it('menolak tabel, kolom konflik, dan filter di luar daftar; batas baris', async () => {
    const { createIdentitySink } = await import('../lib/server/ulanganIdentitySink');
    const req = vi.fn().mockResolvedValue(null);
    const sink = createIdentitySink(req);
    await expect(sink.upsert('teacher_profiles', [{}], 'user_id')).rejects.toThrow(/tidak diizinkan/);
    await expect(sink.upsert('workspaces', [{}], 'id')).rejects.toThrow();
    await expect(sink.upsert('ulh_members', [{}], 'workspace_id')).rejects.toThrow();
    await expect(sink.upsert('ulh_members', Array.from({ length: 501 }, () => ({})), 'user_id')).rejects.toThrow(/terlalu banyak/);
    await expect(sink.remove('ulh_members', 'user_id=neq.x')).rejects.toThrow();
    await expect(sink.remove('ulh_members', 'user_id=eq.x&or=(1.eq.1)')).rejects.toThrow();
    await expect(sink.remove('ulh_members', 'workspace_id=eq.wsA')).rejects.toThrow(); // hapus massal per workspace tidak diizinkan
    await expect(sink.remove('ulh_roster', 'workspace_id=eq.wsA')).rejects.toThrow(); // tanpa batas waktu = hapus semua
    await expect(sink.remove('ulh_audit_log', 'workspace_id=eq.wsA&synced_at=lt.1')).rejects.toThrow();
    await expect(sink.remove('workspaces', 'user_id=eq.x')).rejects.toThrow();
    expect(req).not.toHaveBeenCalled();
    await sink.remove('ulh_members', 'user_id=eq.abc');
    await sink.remove('ulh_roster', 'workspace_id=eq.wsA&synced_at=lt.2026-10-10T10%3A00%3A00.000Z');
    await sink.upsert('ulh_roster', [{ a: 1 }], 'workspace_id,student_id');
    expect(req.mock.calls.map((c) => c[0])).toEqual([
      'ulh_members?user_id=eq.abc',
      'ulh_roster?workspace_id=eq.wsA&synced_at=lt.2026-10-10T10%3A00%3A00.000Z',
      'ulh_roster?on_conflict=workspace_id,student_id',
    ]);
  });
});

describe('pencabutan saat guru dikeluarkan', () => {
  it('no-op saat fitur mati; menghapus baris ulh_members saat aktif; galat tidak menggagalkan pemanggil', async () => {
    const { revokeUlanganMember } = await import('../lib/server/ulanganRevoke');
    const request = vi.fn().mockResolvedValue(null);
    expect(await revokeUlanganMember('g2', { enabled: undefined, request })).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(await revokeUlanganMember('g2', { enabled: 'yes', request })).toBe(true);
    expect(request).toHaveBeenCalledWith('ulh_members?user_id=eq.g2', expect.objectContaining({ method: 'DELETE' }));
    const log = vi.fn();
    expect(await revokeUlanganMember('g2', { enabled: 'yes', request: vi.fn().mockRejectedValue(new Error('down')), log })).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(await revokeUlanganMember('', { enabled: 'yes', request })).toBe(false);
  });
});
