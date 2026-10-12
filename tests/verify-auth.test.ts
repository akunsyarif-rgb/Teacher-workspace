import { describe, expect, it } from 'vitest';
import { checkClaims, decodeClaims, diagnose, redact, runVerification } from '../scripts/supabase/verify-auth.mjs';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.c2ln`;
const NOW = 1_760_000_000_000;
const base = (extra = {}) => ({ iss: 'https://securetoken.google.com/proj', aud: 'proj', sub: 'uid-12345678', exp: NOW / 1000 + 3600, ...extra });

describe('checkClaims', () => {
  it('role hilang terdeteksi', () => {
    const c = checkClaims(base({ firebase: { sign_in_provider: 'password' } }), 'teacher', NOW);
    expect(c.find((x: { name: string }) => x.name.includes('role'))).toMatchObject({ ok: false });
  });
  it('guru valid & anonim valid', () => {
    expect(checkClaims(base({ role: 'authenticated', firebase: { sign_in_provider: 'password' } }), 'teacher', NOW).every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect(checkClaims(base({ role: 'authenticated', firebase: { sign_in_provider: 'anonymous' } }), 'anonymous', NOW).every((x: { ok: boolean }) => x.ok)).toBe(true);
  });
  it('anonim dipakai sebagai guru ditolak; kedaluwarsa & iss salah terdeteksi', () => {
    const anon = base({ role: 'authenticated', firebase: { sign_in_provider: 'anonymous' } });
    expect(checkClaims(anon, 'teacher', NOW).some((x: { ok: boolean }) => !x.ok)).toBe(true);
    expect(checkClaims({ ...anon, exp: 1 }, 'anonymous', NOW).some((x: { name: string; ok: boolean }) => x.name.includes('kedaluwarsa') && !x.ok)).toBe(true);
    expect(checkClaims({ ...anon, iss: 'x' }, 'anonymous', NOW).some((x: { ok: boolean }) => !x.ok)).toBe(true);
  });
});

describe('redact/diagnose', () => {
  it('JWT dan rahasia diredaksi', () => {
    const t = jwt({ sub: 'a' });
    expect(redact(`gagal ${t} dan pw=hunter22!`, ['hunter22!'])).toBe('gagal [JWT-REDACTED] dan pw=[REDACTED]');
  });
  it('diagnosis memberi tindakan', () => {
    expect(diagnose(401, { message: 'role claim missing' })).toMatch(/custom claim/);
    expect(diagnose(401, { message: 'invalid JWT' })).toMatch(/Third-Party Auth/);
    expect(diagnose(200, [])).toBeNull();
  });
  it('decodeClaims', () => {
    expect(decodeClaims(jwt({ sub: 'z' })).sub).toBe('z');
  });
});

// Server palsu: Firebase identitytoolkit + Supabase PostgREST.
function fakeWorld(opts: { role?: string | undefined; supabaseAccepts?: boolean; probe?: boolean; leakRows?: boolean }) {
  const teacherTok = jwt(base({ ...(opts.role !== undefined && { role: opts.role }), firebase: { sign_in_provider: 'password' } }));
  const anonTok = jwt(base({ sub: 'anon-uid-1', ...(opts.role !== undefined && { role: opts.role }), firebase: { sign_in_provider: 'anonymous' } }));
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u.replace(/\?key=.*/, '')}`);
    const res = (status: number, body: unknown) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) });
    if (u.includes('accounts:signInWithPassword')) return res(200, { idToken: teacherTok });
    if (u.includes('accounts:signUp')) return res(200, { idToken: anonTok });
    const auth = String((init?.headers as Record<string, string>).Authorization);
    const token = auth.replace('Bearer ', '');
    const isUser = token === teacherTok || token === anonTok;
    if (token === 'bukan.token.valid') return res(401, { message: 'invalid JWT' });
    if (!isUser) return res(401, { code: '42501', message: 'permission denied for table teacher_profiles' });
    if (!opts.supabaseAccepts) return res(401, { message: 'role claim missing' });
    if (u.endsWith('/rpc/auth_probe')) {
      if (!opts.probe) return res(404, { code: 'PGRST202', message: 'function not found' });
      const sub = token === teacherTok ? 'uid-12345678' : 'anon-uid-1';
      return res(200, { role: 'authenticated', sub, uid: sub, provider: token === teacherTok ? 'password' : 'anonymous', has_teacher_profile: false, has_student_profile: false });
    }
    return res(200, opts.leakRows && token === anonTok ? [{ id: 'x' }] : []);
  }) as unknown as typeof fetch;
  return { f, calls, teacherTok, anonTok };
}
const ENV = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123', FIREBASE_WEB_API_KEY: 'AIzaFAKEKEY123', TEACHER_EMAIL: 'guru@example.com', TEACHER_PASSWORD: 'hunter22!' };

describe('runVerification (server palsu)', () => {
  it('semua benar → exit 0, guru & siswa anonim terpisah, TIDAK ADA token/sandi di keluaran', async () => {
    const w = fakeWorld({ role: 'authenticated', supabaseAccepts: true, probe: true });
    const lines: string[] = [];
    const r = await runVerification(ENV, { fetchImpl: w.f, log: (l: string) => lines.push(l), now: NOW });
    const text = lines.join('\n');
    expect(r.exitCode).toBe(0);
    expect(text).toContain('[guru]');
    expect(text).toContain('[siswa-anonim]');
    for (const secret of [w.teacherTok, w.anonTok, 'hunter22!', 'guru@example.com', 'AIzaFAKEKEY123', 'sb_publishable_abc123']) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/eyJ/);
  });
  it('tanpa claim role → exit 1 dengan petunjuk tindakan', async () => {
    const w = fakeWorld({ role: undefined, supabaseAccepts: false, probe: true });
    const lines: string[] = [];
    const r = await runVerification(ENV, { fetchImpl: w.f, log: (l: string) => lines.push(l), now: NOW });
    expect(r.exitCode).toBe(1);
    expect(lines.join('\n')).toMatch(/custom claim|role/i);
  });
  it('probe belum dipasang → fallback tabel', async () => {
    const w = fakeWorld({ role: 'authenticated', supabaseAccepts: true, probe: false });
    const lines: string[] = [];
    const r = await runVerification(ENV, { fetchImpl: w.f, log: (l: string) => lines.push(l), now: NOW });
    expect(r.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('belum terpasang');
  });
  it('siswa anonim melihat baris tanpa profil → RLS FAIL', async () => {
    const w = fakeWorld({ role: 'authenticated', supabaseAccepts: true, probe: true, leakRows: true });
    const r = await runVerification(ENV, { fetchImpl: w.f, log: () => {}, now: NOW });
    expect(r.exitCode).toBe(1);
  });
  it('guru tanpa kredensial dilewati; anonim tetap jalan; hanya GET/POST aman (tidak ada PATCH/DELETE)', async () => {
    const w = fakeWorld({ role: 'authenticated', supabaseAccepts: true, probe: true });
    const noTeacher: Record<string, string> = { ...ENV };
    delete noTeacher.TEACHER_EMAIL;
    delete noTeacher.TEACHER_PASSWORD;
    const r = await runVerification(noTeacher, { fetchImpl: w.f, log: () => {}, now: NOW });
    expect(r.results.some((x: { who: string }) => x.who === 'teacher')).toBe(false);
    expect(r.results.some((x: { who: string }) => x.who === 'anonymous')).toBe(true);
    expect(w.calls.some((c) => /^(PATCH|DELETE|PUT)/.test(c))).toBe(false);
  });
  it('konfigurasi kurang → exit 2', async () => {
    expect((await runVerification({}, { log: () => {} })).exitCode).toBe(2);
  });
});
