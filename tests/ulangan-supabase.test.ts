import { describe, expect, it, vi } from 'vitest';
import { UlanganDbError, ulanganAuthHeaders, ulanganRpc, ulanganSupabaseConfig } from '../lib/server/ulanganSupabase';

// Jalur server → Supabase untuk Ulangan Harian (fetch palsu): hanya RPC ulh_*, URL divalidasi, SmadaExam ditolak, secret tak bocor.
const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_secret_SUPER_RAHASIA_123';
const env = (o: Record<string, string | undefined> = {}) => ({ SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: KEY, ...o });
const ok = (body: unknown, status = 200) => vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

describe('konfigurasi', () => {
  it('menerima https://<ref>.supabase.co (path /rest/v1 & slash dibuang); key dari SUPABASE_SECRET_KEY atau SERVICE_ROLE_KEY', () => {
    expect(ulanganSupabaseConfig(env({ SUPABASE_URL: `${URL_OK}/rest/v1/` }))).toEqual({ url: URL_OK, key: KEY });
    expect(ulanganSupabaseConfig({ SUPABASE_URL: URL_OK, SUPABASE_SERVICE_ROLE_KEY: 'k2' })).toEqual({ url: URL_OK, key: 'k2' });
  });
  it('menolak: tanpa key/URL, host asing, http, SmadaExam, lokal tanpa emulator', () => {
    for (const e of [
      { SUPABASE_URL: URL_OK }, { SUPABASE_SECRET_KEY: KEY }, env({ SUPABASE_URL: 'https://evil.example.com' }), env({ SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' }),
      env({ SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co.evil.com' }), env({ SUPABASE_URL: 'https://abdkrhmxfpcmgzsxzfyz.supabase.co' }),
      env({ SUPABASE_URL: 'http://127.0.0.1:4600' }), env({ SUPABASE_URL: 'http://localhost:4600', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
      env({ SUPABASE_URL: 'http://127.0.0.1.evil.com:4600', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), env({ SUPABASE_URL: '' }),
    ]) expect(() => ulanganSupabaseConfig(e), JSON.stringify(e.SUPABASE_URL)).toThrow(expect.objectContaining({ kind: 'config', status: 503 }));
  });
  it('gateway lokal http://127.0.0.1:<port> hanya bila Firestore Emulator aktif', () => {
    expect(ulanganSupabaseConfig(env({ SUPABASE_URL: 'http://127.0.0.1:4600', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).url).toBe('http://127.0.0.1:4600');
  });
});

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as UlanganDbError;

const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`;

describe('autentikasi ke gateway Supabase (regresi HTTP 401)', () => {
  it('sb_secret_… : hanya apikey (tanpa Authorization Bearer); JWT legacy service_role: apikey + Bearer', () => {
    expect(ulanganAuthHeaders(KEY)).toEqual({ 'Content-Type': 'application/json', apikey: KEY });
    const legacy = jwt({ role: 'service_role', ref: 'abcdefghijklmnopqrst' });
    expect(ulanganAuthHeaders(legacy)).toEqual({ 'Content-Type': 'application/json', apikey: legacy, Authorization: `Bearer ${legacy}` });
  });
  it('key salah jenis ditolak sebelum jaringan: publishable, anon JWT, JWT project lain', async () => {
    const f = ok([]);
    const cases: [string, string][] = [
      ['sb_publishable_AbCdEf123', 'server_config_key_publishable'],
      [jwt({ role: 'anon', ref: 'abcdefghijklmnopqrst' }), 'server_config_key_not_service'],
      [jwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }), 'server_config_key_wrong_project'],
    ];
    for (const [key, code] of cases) {
      await expect(ulanganRpc('ulh_list_exams', {}, { env: env({ SUPABASE_SECRET_KEY: key }), fetchImpl: f as never }), code).rejects.toMatchObject({ kind: 'config', message: code });
    }
    expect(f).not.toHaveBeenCalled();
    expect(ulanganSupabaseConfig(env({ SUPABASE_SECRET_KEY: jwt({ role: 'service_role', ref: 'abcdefghijklmnopqrst' }) })).key).toContain('eyJ'); // legacy yang benar lolos
  });
  it('penolakan hulu 401 diberi label konstan (tanpa teks asli, tanpa secret)', async () => {
    const cases: [object, string][] = [
      [{ message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' }, 'invalid_api_key'],
      [{ code: 'PGRST301', message: 'JWSError (CompactDecodeError Invalid number of parts)' }, 'invalid_jwt'],
      [{ code: 'PGRST303', message: 'JWT expired' }, 'jwt_expired'],
      [{ code: '42501', message: 'permission denied for function ulh_list_exams' }, 'permission_denied'],
      [{ code: 'PGRST202', message: 'Could not find the function public.ulh_x' }, 'function_missing'],
      [{ message: 'sesuatu lain' }, ''],
    ];
    for (const [body, hint] of cases) {
      const e = await err(ulanganRpc('ulh_x', {}, { env: env(), fetchImpl: ok(body, 401) as never }));
      expect(e).toMatchObject({ kind: 'db', status: 401, hint });
    }
  });
});

describe('ulanganRpc', () => {
  it('POST ke /rest/v1/rpc/<ulh_*> dengan key hanya di header; mengembalikan JSON', async () => {
    const f = ok({ a: 1 });
    expect(await ulanganRpc('ulh_list_exams', { p_ws: 'w' }, { env: env(), fetchImpl: f as never })).toEqual({ a: 1 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${URL_OK}/rest/v1/rpc/ulh_list_exams`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: KEY });
    expect(init.headers).not.toHaveProperty('Authorization'); // key baru bukan JWT: hanya header apikey (regresi 401 di Preview)
    expect(init.body).toBe('{"p_ws":"w"}');
    expect(init.body).not.toContain(KEY);
    expect(await ulanganRpc('ulh_publish_exam', {}, { env: env(), fetchImpl: ok(undefined, 204) as never })).toBeNull(); // void
  });
  it('hanya fungsi ulh_*: nama lain/ber-traversal ditolak SEBELUM jaringan', async () => {
    const f = ok(null);
    for (const n of ['batch_write', 'rpc/ulh_x', 'ulh_x/../y', 'ULH_X', 'ulh_', 'ulh_x?select=*', '', 'ulh_' + 'a'.repeat(80)])
      await expect(ulanganRpc(n, {}, { env: env(), fetchImpl: f as never }), n).rejects.toMatchObject({ code: '22023' });
    expect(f).not.toHaveBeenCalled();
  });
  it('galat DB → UlanganDbError(kode, pesan terpotong); jaringan/timeout → network tanpa pesan asli; secret tak muncul di galat', async () => {
    const e1 = await err(ulanganRpc('ulh_x', {}, { env: env(), fetchImpl: ok({ message: 'exam_locked', code: 'P0001' }, 400) as never }));
    expect(e1).toBeInstanceOf(UlanganDbError);
    expect(e1).toMatchObject({ message: 'exam_locked', code: 'P0001', status: 400, kind: 'db' });
    const e2 = await err(ulanganRpc('ulh_x', {}, { env: env(), fetchImpl: vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${URL_OK} key=${KEY}`)) as never }));
    expect(e2).toMatchObject({ kind: 'network', message: 'network' });
    const e3 = await err(ulanganRpc('ulh_x', {}, { env: env(), fetchImpl: ok({ message: 'x'.repeat(500) }, 500) as never }));
    expect(e3.message.length).toBeLessThanOrEqual(200);
    for (const e of [e1, e2, e3]) expect(`${e.message} ${JSON.stringify(e)}`).not.toContain(KEY);
    const e4 = await err(ulanganRpc('ulh_x', {}, { env: { SUPABASE_URL: URL_OK }, fetchImpl: ok(null) as never }));
    expect(e4).toMatchObject({ kind: 'config' });
  });
});
