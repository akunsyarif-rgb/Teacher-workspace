import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseTokenProvider } from '../lib/adapters/firebaseRoleClaim';
import { runSupabaseDiagnostics } from '../lib/diagnostics/supabaseCheck';
import { decodeJwtClaims, hasAuthenticatedRole } from '../lib/utils/jwtClaims';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (c: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(c)}.sig`;
const claims = (extra = {}) => ({ iss: 'https://securetoken.google.com/proj', aud: 'proj', sub: 'uid1', firebase: { sign_in_provider: 'anonymous' }, ...extra });

// Pengguna Firebase palsu: claim baru hanya muncul setelah getIdToken(true) SESUDAH server memasangnya.
function fakeUser(uid = 'uid1') {
  const state = { claimInstalled: false, refreshes: 0 };
  return {
    state,
    user: {
      uid,
      async getIdToken(force?: boolean) {
        if (force) state.refreshes++;
        return jwt(claims({ sub: uid, ...(state.claimInstalled && (force || state.refreshes > 0) ? { role: 'authenticated' } : {}) }));
      },
    },
  };
}

describe('jwtClaims', () => {
  it('decode UTF-8 & base64url; hasAuthenticatedRole', () => {
    expect(decodeJwtClaims(jwt({ name: 'Bu Rahmä', role: 'authenticated' }))).toMatchObject({ name: 'Bu Rahmä' });
    expect(hasAuthenticatedRole(jwt({ role: 'authenticated' }))).toBe(true);
    expect(hasAuthenticatedRole(jwt({ role: 'anon' }))).toBe(false);
    expect(hasAuthenticatedRole('bukan-jwt')).toBe(false);
  });
});

describe('createSupabaseTokenProvider', () => {
  it('tanpa pengguna → null, tanpa request', async () => {
    const f = vi.fn();
    expect(await createSupabaseTokenProvider({ getUser: () => null, fetchImpl: f as never })()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('token sudah punya role → dipakai langsung, endpoint TIDAK dipanggil', async () => {
    const f = vi.fn();
    const user = { getIdToken: async () => jwt(claims({ role: 'authenticated' })) };
    const t = await createSupabaseTokenProvider({ getUser: () => user, fetchImpl: f as never })();
    expect(hasAuthenticatedRole(t as string)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
  it('tanpa role → POST ke endpoint dengan token pengguna, lalu token diperbarui membawa role', async () => {
    const { user, state } = fakeUser();
    const calls: { url: string; auth: string }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization) });
      state.claimInstalled = true;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });
    const t = await createSupabaseTokenProvider({ getUser: () => user, fetchImpl: f as never })();
    expect(hasAuthenticatedRole(t as string)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/auth/supabase-claim');
    expect(calls[0].auth).toMatch(/^Bearer eyJ/);
    expect(state.refreshes).toBe(1);
  });
  it('permintaan bersamaan digabung: satu panggilan server', async () => {
    const { user, state } = fakeUser();
    const f = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); state.claimInstalled = true; return { ok: true, status: 200, json: async () => ({}) }; });
    const get = createSupabaseTokenProvider({ getUser: () => user, fetchImpl: f as never });
    await Promise.all([get(), get(), get()]);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('server menolak (501 belum aktif / 401) → error auth yang jelas, tidak mengembalikan token tanpa role', async () => {
    const { user } = fakeUser();
    const f = vi.fn(async () => ({ ok: false, status: 501, json: async () => ({ error: 'Fitur belum diaktifkan.' }) }));
    await expect(createSupabaseTokenProvider({ getUser: () => user, fetchImpl: f as never })()).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('501') });
  });
  it('claim terpasang tetapi tidak muncul setelah refresh → error, bukan token palsu', async () => {
    const { user } = fakeUser();
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })); // server mengaku sukses tetapi claimInstalled tetap false
    await expect(createSupabaseTokenProvider({ getUser: () => user, fetchImpl: f as never })()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('runSupabaseDiagnostics', () => {
  const ENV = { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_x' };
  type Plan = { teacherProfiles?: number; probe?: 'ok' | 'missing'; claimEndpoint?: number; anonLeak?: boolean };
  function world(plan: Plan = {}) {
    const { user, state } = fakeUser();
    const log: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const u = String(url);
      const auth = String((init.headers as Record<string, string>)?.Authorization ?? '');
      log.push(`${init.method ?? 'GET'} ${u.replace(/^https:\/\/[^/]+/, '')}`);
      const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
      if (u === '/api/auth/supabase-claim') {
        if ((plan.claimEndpoint ?? 200) === 200) { state.claimInstalled = true; return res(200, { ok: true }); }
        return res(plan.claimEndpoint!, { error: 'x' });
      }
      const isUser = auth !== 'Bearer sb_publishable_x';
      if (u.includes('/rpc/auth_probe')) return plan.probe === 'ok' ? res(200, { role: 'authenticated', uid: 'uid1', sub: 'uid1' }) : res(404, { code: 'PGRST202', message: 'nf' });
      if (!isUser) return plan.anonLeak ? res(200, [{ user_id: 'x' }]) : res(401, { message: 'permission denied' });
      if (isUser && !/"role":"authenticated"/.test(Buffer.from(auth.split('.')[1] ?? '', 'base64url').toString())) return res(401, { message: 'No suitable key or wrong key type' });
      return res(200, []);
    }) as unknown as typeof fetch;
    return { user, state, log, fetchImpl };
  }
  const byId = (r: { id: string }[], id: string) => r.find((x) => x.id === id) as unknown as { status: string; detail: string };

  it('semua benar (siswa anonim, probe terpasang) → semua pass; tidak ada token di keluaran', async () => {
    const w = world({ probe: 'ok' });
    const r = await runSupabaseDiagnostics({ getUser: () => w.user, env: ENV, fetchImpl: w.fetchImpl });
    for (const id of ['config', 'session', 'claim', 'anon', 'accepted', 'identity']) expect(byId(r, id).status, id).toBe('pass');
    expect(JSON.stringify(r)).not.toMatch(/eyJ/);
    expect(byId(r, 'session').detail).toContain('siswa anonim');
  });
  it('probe belum dipasang → identitas "info", bukan gagal', async () => {
    const w = world();
    const r = await runSupabaseDiagnostics({ getUser: () => w.user, env: ENV, fetchImpl: w.fetchImpl });
    expect(byId(r, 'identity').status).toBe('info');
  });
  it('endpoint claim belum aktif (501) → claim gagal dengan petunjuk ENABLE_SUPABASE_CLAIM, berhenti sebelum uji token', async () => {
    const w = world({ claimEndpoint: 501 });
    const r = await runSupabaseDiagnostics({ getUser: () => w.user, env: ENV, fetchImpl: w.fetchImpl });
    expect(byId(r, 'claim').status).toBe('fail');
    expect(byId(r, 'claim').detail).toContain('ENABLE_SUPABASE_CLAIM');
    expect(r.find((x) => x.id === 'accepted')).toBeUndefined();
  });
  it('Third-Party Auth belum diatur → token ditolak dengan petunjuk Project ID', async () => {
    const w = world();
    const f = (async (u: string, i?: RequestInit) => {
      const auth = String((i?.headers as Record<string, string>)?.Authorization ?? '');
      if (String(u).includes('/rest/v1/') && auth !== 'Bearer sb_publishable_x') return { ok: false, status: 401, text: async () => JSON.stringify({ message: 'JWT issuer is not trusted' }), json: async () => ({}) };
      return w.fetchImpl(u, i);
    }) as unknown as typeof fetch;
    const r = await runSupabaseDiagnostics({ getUser: () => w.user, env: ENV, fetchImpl: f });
    expect(byId(r, 'accepted').status).toBe('fail');
    expect(byId(r, 'accepted').detail).toContain('Third-Party Auth');
  });
  it('kebocoran tanpa login terdeteksi sebagai FAIL', async () => {
    const w = world({ anonLeak: true });
    const r = await runSupabaseDiagnostics({ getUser: () => w.user, env: ENV, fetchImpl: w.fetchImpl });
    expect(byId(r, 'anon').status).toBe('fail');
  });
  it('konfigurasi kosong / project SmadaExam / tanpa sesi → berhenti dengan penjelasan, tanpa request', async () => {
    const f = vi.fn();
    expect(byId(await runSupabaseDiagnostics({ getUser: () => null, env: {}, fetchImpl: f as never }), 'config').status).toBe('fail');
    expect(byId(await runSupabaseDiagnostics({ getUser: () => null, env: { url: 'https://abdkrhmxfpcmgzsxzfyz.supabase.co', publishableKey: 'k' }, fetchImpl: f as never }), 'config').detail).toContain('salah');
    expect(byId(await runSupabaseDiagnostics({ getUser: () => null, env: ENV, fetchImpl: f as never }), 'session').status).toBe('fail');
    expect(f).not.toHaveBeenCalled();
  });
  it('hanya GET dan RPC read-only (auth_probe) ke Supabase; satu-satunya tulis = endpoint claim server', async () => {
    const w = world({ probe: 'ok' });
    await runSupabaseDiagnostics({ getUser: () => w.user, env: ENV, fetchImpl: w.fetchImpl });
    const writes = w.log.filter((l) => !l.startsWith('GET '));
    expect(writes.sort()).toEqual(['POST /api/auth/supabase-claim', 'POST /rest/v1/rpc/auth_probe']);
  });
});

// Satu mock Firebase Admin untuk semua uji endpoint di file ini.
const admin = vi.hoisted(() => ({
  verify: vi.fn(), getUser: vi.fn(), setClaims: vi.fn(),
  }));
vi.mock('../lib/server/firebaseAdmin', () => ({ getAdminAuth: () => ({ verifyIdToken: admin.verify, getUser: admin.getUser, setCustomUserClaims: admin.setClaims }) }));

describe('endpoint /api/auth/supabase-claim', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const m of Object.values(admin)) m.mockReset(); });
  const req = (token?: string) => new Request('http://x/api/auth/supabase-claim', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} }) as unknown as import('next/server').NextRequest;

  it('DEFAULT MATI: tanpa ENABLE_SUPABASE_CLAIM=yes → 501 dan Firebase Admin tidak disentuh', async () => {
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    expect((await POST(req('tok'))).status).toBe(501);
    expect(admin.verify).not.toHaveBeenCalled();
  });
  it('aktif: tanpa token → 401; token tidak valid → 401', async () => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', 'yes');
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    expect((await POST(req())).status).toBe(401);
    admin.verify.mockRejectedValue(new Error('bad'));
    expect((await POST(req('tok'))).status).toBe(401);
    expect(admin.setClaims).not.toHaveBeenCalled();
  });
  it('aktif: memasang role="authenticated" untuk uid dari token terverifikasi dan MEMPERTAHANKAN claim lain', async () => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', 'yes');
    admin.verify.mockResolvedValue({ uid: 'u1' });
    admin.getUser.mockResolvedValue({ customClaims: { kelas: '7A' } });
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    const res = await POST(req('tok'));
    expect(res.status).toBe(200);
    expect(admin.setClaims).toHaveBeenCalledWith('u1', { kelas: '7A', role: 'authenticated' });
    expect(await res.json()).toMatchObject({ ok: true, alreadySet: false });
  });
  it('verifikasi dengan checkRevoked=true dan hanya uid dari token yang dipakai (bukan body/header lain)', async () => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', 'yes');
    admin.verify.mockResolvedValue({ uid: 'uidToken' });
    admin.getUser.mockResolvedValue({ customClaims: {} });
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    const r = new Request('http://x/api/auth/supabase-claim?uid=orangLain', { method: 'POST', headers: { authorization: 'Bearer tok', 'x-uid': 'orangLain' }, body: JSON.stringify({ uid: 'orangLain', claims: { role: 'admin' } }) }) as unknown as import('next/server').NextRequest;
    await POST(r);
    expect(admin.verify).toHaveBeenCalledWith('tok', true);
    expect(admin.getUser).toHaveBeenCalledWith('uidToken');
    expect(admin.setClaims).toHaveBeenCalledTimes(1);
    expect(admin.setClaims).toHaveBeenCalledWith('uidToken', { role: 'authenticated' });
  });
  it('gagal memasang claim (izin service account) → 500 dengan petunjuk, tanpa membocorkan detail/secret', async () => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', 'yes');
    admin.verify.mockResolvedValue({ uid: 'u1' });
    admin.getUser.mockResolvedValue({ customClaims: {} });
    admin.setClaims.mockRejectedValue(new Error('PERMISSION_DENIED private_key=SECRET123'));
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    const res = await POST(req('tok'));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Firebase Authentication Admin');
    expect(text).not.toMatch(/SECRET123|private_key|PERMISSION_DENIED/);
  });
  it('aktif: sudah punya role → tidak menulis apa pun', async () => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', 'yes');
    admin.verify.mockResolvedValue({ uid: 'u1', role: 'authenticated' });
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    expect(await (await POST(req('tok'))).json()).toMatchObject({ alreadySet: true });
    expect(admin.setClaims).not.toHaveBeenCalled();
  });
});

import { describeClaimFlag, isClaimEnabled } from '../lib/server/claimFlag';

describe('saklar ENABLE_SUPABASE_CLAIM', () => {
  it.each(['yes', 'YES', ' yes ', '"yes"', "'yes'", 'Yes\n', 'true', '1', 'ya'])('nilai %j → aktif', (v) => {
    expect(isClaimEnabled(v)).toBe(true);
  });
  it.each([undefined, '', '   ', 'no', 'y', 'yess', 'false', '0', 'tidak', 'yes please', '""'])('nilai %j → MATI (default aman)', (v) => {
    expect(isClaimEnabled(v)).toBe(false);
  });
});

describe('diagnostik 501 (non-rahasia)', () => {
  const base = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'cc027856fb778ee4db8f728a96fc2e794eb70292', VERCEL_GIT_COMMIT_REF: 'feat/supabase-adapter-skip-reasons' };
  it('variabel tidak ada → petunjuk Redeploy/cakupan/nama, identitas deployment (commit pendek)', () => {
    const d = describeClaimFlag({ ...base }) as { hint: string; deployment: { commit: string; environment: string; branch: string } };
    expect(d.hint).toContain('TIDAK ADA');
    expect(d.hint).toContain('Redeploy');
    expect(d.deployment).toEqual({ environment: 'preview', commit: 'cc02785', branch: 'feat/supabase-adapter-skip-reasons' });
  });
  it('variabel ada tetapi bukan yes → melaporkan PANJANG saja, tidak pernah nilainya', () => {
    const d = describeClaimFlag({ ...base, ENABLE_SUPABASE_CLAIM: 'nope-RAHASIA' });
    expect(JSON.stringify(d)).not.toContain('nope-RAHASIA');
    expect(JSON.stringify(d)).toContain('panjang 12');
  });
  it('variabel kosong; nama mirip (salah ketik) terdeteksi namanya saja', () => {
    expect((describeClaimFlag({ ...base, ENABLE_SUPABASE_CLAIM: '' }) as { hint: string }).hint).toContain('KOSONG');
    const d = describeClaimFlag({ ...base, ENABLE_SUPABASE_CLAIMS: 'yes', 'enable_supabase_claim': 'yes' }) as { hint: string };
    expect(d.hint).toContain('ENABLE_SUPABASE_CLAIMS');
    expect(d.hint).toContain('enable_supabase_claim');
    expect(JSON.stringify(d)).not.toMatch(/"yes"/);
  });
  it('Production: hanya pesan minimal (tanpa commit/cabang/petunjuk)', () => {
    expect(describeClaimFlag({ ...base, VERCEL_ENV: 'production' })).toEqual({ error: 'Fitur belum diaktifkan.' });
  });
});

describe('endpoint: env aktif vs tidak aktif (Vercel Preview)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const m of Object.values(admin)) m.mockReset(); });
  const post = (token = 'tok') => new Request('http://x/api/auth/supabase-claim', { method: 'POST', headers: { authorization: `Bearer ${token}` } }) as unknown as import('next/server').NextRequest;

  it('env TIDAK ADA di deployment → 501 dengan diagnostik; Firebase Admin tidak disentuh', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'cc027856fb778ee4db8f728a96fc2e794eb70292');
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    const res = await POST(post());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.hint).toContain('TIDAK ADA');
    expect(body.deployment.commit).toBe('cc02785');
    expect(admin.verify).not.toHaveBeenCalled();
  });
  it.each(['yes', ' YES ', '"yes"'])('env %j → aktif: token diverifikasi, claim dipasang untuk uid dari token', async (v) => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', v);
    admin.verify.mockResolvedValue({ uid: 'u1' });
    admin.getUser.mockResolvedValue({ customClaims: { a: 1 } });
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    expect((await POST(post())).status).toBe(200);
    expect(admin.setClaims).toHaveBeenCalledWith('u1', { a: 1, role: 'authenticated' });
  });
  it('env salah nilai → 501 (tidak aktif) dan tidak menulis claim', async () => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', 'no');
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    expect((await POST(post())).status).toBe(501);
    expect(admin.setClaims).not.toHaveBeenCalled();
  });
  it('aktif TETAP menolak tanpa token (401) dan token tak valid (401): guard keamanan tidak dilonggarkan', async () => {
    vi.stubEnv('ENABLE_SUPABASE_CLAIM', 'yes');
    const { POST } = await import('../app/api/auth/supabase-claim/route');
    const noTok = new Request('http://x/api/auth/supabase-claim', { method: 'POST' }) as unknown as import('next/server').NextRequest;
    expect((await POST(noTok)).status).toBe(401);
    admin.verify.mockRejectedValue(new Error('x'));
    expect((await POST(post('salah'))).status).toBe(401);
    expect(admin.setClaims).not.toHaveBeenCalled();
  });
});

describe('klien menampilkan penyebab 501 dari server', () => {
  it('pesan error provider memuat hint + identitas deployment', async () => {
    const user = { getIdToken: async () => jwt(claims()) };
    const f = vi.fn(async () => ({ ok: false, status: 501, json: async () => ({ error: 'Fitur belum diaktifkan.', hint: 'Variabel ENABLE_SUPABASE_CLAIM TIDAK ADA di deployment ini.', deployment: { environment: 'preview', branch: 'b', commit: 'cc02785' } }) }));
    await expect(createSupabaseTokenProvider({ getUser: () => user, fetchImpl: f as never })()).rejects.toMatchObject({ message: expect.stringMatching(/TIDAK ADA.*preview b cc02785/) });
  });
});
