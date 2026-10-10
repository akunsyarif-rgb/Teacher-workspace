#!/usr/bin/env node
/*
 * Verifikasi LOKAL: apakah Supabase (project Workflow) menerima ID token Firebase,
 * dengan identitas & RLS yang benar. READ-ONLY terhadap data (hanya GET + RPC auth_probe
 * bila sudah dipasang). TIDAK PERNAH mencetak token; semua keluaran diredaksi.
 *
 * Env (set di shell Anda sendiri, jangan ditempel ke percakapan):
 *   SUPABASE_URL=https://<ref>.supabase.co
 *   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...        (kunci publik, bukan secret)
 *   FIREBASE_WEB_API_KEY=...                           (NEXT_PUBLIC_FIREBASE_API_KEY)
 *   TEACHER_EMAIL=... TEACHER_PASSWORD=...             (akun guru uji; tanpa ini guru dilewati)
 *   (siswa anonim: otomatis membuat user anonim Firebase baru; --skip-anonymous untuk melewati)
 *
 *   node scripts/supabase/verify-auth.mjs [--skip-anonymous] [--skip-teacher]
 * Exit code: 0 semua yang dijalankan lulus | 1 ada yang gagal | 2 konfigurasi kurang.
 */
import { pathToFileURL } from 'node:url';

const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;

export function redact(text, secrets = []) {
  let out = String(text).replace(JWT_RE, '[JWT-REDACTED]');
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  return out;
}

export function mask(value) {
  const s = String(value ?? '');
  return s.length <= 8 ? `${s.slice(0, 2)}…` : `${s.slice(0, 4)}…${s.slice(-2)} (len ${s.length})`;
}

export function decodeClaims(token) {
  const part = String(token).split('.')[1];
  if (!part) throw new Error('Token bukan JWT.');
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

// Pemeriksaan klaim yang dibutuhkan Supabase Third-Party Auth (Firebase). `kind`: 'teacher' | 'anonymous'.
export function checkClaims(claims, kind, now = Date.now()) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add('iss = securetoken.google.com/<project>', claims.iss === `https://securetoken.google.com/${claims.aud}`, `aud=${claims.aud}`);
  add('sub ada', typeof claims.sub === 'string' && claims.sub.length > 0, claims.sub ? mask(claims.sub) : 'kosong');
  add('claim role = "authenticated"', claims.role === 'authenticated',
    claims.role === undefined ? 'TIDAK ADA (Supabase menolak token tanpa role)' : `role=${claims.role}`);
  add('belum kedaluwarsa', typeof claims.exp === 'number' && claims.exp * 1000 > now, `sisa ${Math.round(((claims.exp ?? 0) * 1000 - now) / 60000)} menit`);
  const provider = claims.firebase?.sign_in_provider;
  add(kind === 'anonymous' ? 'provider = anonymous' : 'provider = password/google (bukan anonymous)',
    kind === 'anonymous' ? provider === 'anonymous' : provider !== undefined && provider !== 'anonymous', `provider=${provider}`);
  return checks;
}

// Penjelasan tindakan untuk status HTTP/pesan Supabase yang umum.
export function diagnose(status, body) {
  const msg = typeof body === 'object' && body ? `${body.code ?? ''} ${body.message ?? ''}`.trim() : String(body ?? '');
  if (status === 200) return null;
  if (status === 401 && /role/i.test(msg)) return `Claim "role" tidak ada/ salah di token. Tambahkan custom claim role="authenticated" (Firebase blocking function beforeUserCreated/beforeSignIn atau Admin SDK setCustomUserClaims). [${msg}]`;
  if (status === 401) return `Token ditolak. Cek Dashboard Supabase → Authentication → Sign In / Providers → Third-Party Auth → Firebase (Project ID harus sama dengan "aud" token). [${msg}]`;
  if (status === 403 || /permission denied/i.test(msg)) return `Akses ditolak oleh grant/RLS. [${msg}]`;
  if (status === 404) return `Endpoint tidak ada. [${msg}]`;
  return `HTTP ${status}. [${msg}]`;
}

async function json(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

export async function runVerification(env, { fetchImpl = fetch, log = console.log, now = Date.now() } = {}) {
  const base = String(env.SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const pub = env.SUPABASE_PUBLISHABLE_KEY;
  const fbKey = env.FIREBASE_WEB_API_KEY;
  const idt = env.FIREBASE_IDENTITY_URL ?? 'https://identitytoolkit.googleapis.com/v1';
  const argv = env.__ARGV ?? [];
  const secrets = [pub, fbKey, env.TEACHER_PASSWORD, env.TEACHER_EMAIL];
  const out = (line) => log(redact(line, secrets));

  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base) || !pub || !fbKey) {
    out('Konfigurasi kurang: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, FIREBASE_WEB_API_KEY wajib.');
    return { exitCode: 2, results: [] };
  }

  const rest = async (path, token, init = {}) => {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: pub, Authorization: `Bearer ${token ?? pub}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    return { status: res.status, body: await json(res) };
  };

  const signIn = async (kind) => {
    const endpoint = kind === 'teacher' ? 'accounts:signInWithPassword' : 'accounts:signUp';
    const payload = kind === 'teacher'
      ? { email: env.TEACHER_EMAIL, password: env.TEACHER_PASSWORD, returnSecureToken: true }
      : { returnSecureToken: true };
    const res = await fetchImpl(`${idt}/${endpoint}?key=${encodeURIComponent(fbKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await json(res);
    if (res.status !== 200 || !body.idToken) throw new Error(`Login Firebase gagal (${res.status}): ${body?.error?.message ?? 'tanpa pesan'}`);
    return body.idToken;
  };

  const results = [];
  const kinds = [];
  if (!argv.includes('--skip-teacher')) {
    if (env.TEACHER_EMAIL && env.TEACHER_PASSWORD) kinds.push('teacher');
    else out('[guru] DILEWATI: TEACHER_EMAIL/TEACHER_PASSWORD tidak diset.');
  }
  if (!argv.includes('--skip-anonymous')) kinds.push('anonymous');

  // Kontrol negatif: tanpa token pengguna tidak boleh ada akses.
  const anon = await rest('teacher_profiles?select=user_id&limit=1', null);
  const anonOk = anon.status === 401 || anon.status === 403 || (anon.status === 200 && Array.isArray(anon.body) && anon.body.length === 0);
  results.push({ who: 'kontrol', name: 'tanpa token pengguna: tidak ada data', ok: anonOk });
  out(`[kontrol] tanpa token pengguna → HTTP ${anon.status} ${anonOk ? 'PASS' : 'FAIL (data bocor?)'}`);

  const garbage = await rest('teacher_profiles?select=user_id&limit=1', 'bukan.token.valid');
  const garbageOk = garbage.status === 401;
  results.push({ who: 'kontrol', name: 'token sampah ditolak (401)', ok: garbageOk });
  out(`[kontrol] token sampah → HTTP ${garbage.status} ${garbageOk ? 'PASS' : 'FAIL'}`);

  for (const kind of kinds) {
    const tag = kind === 'teacher' ? '[guru]' : '[siswa-anonim]';
    let token;
    try { token = await signIn(kind); } catch (e) {
      out(`${tag} FAIL ${e.message}`);
      results.push({ who: kind, name: 'login Firebase', ok: false });
      continue;
    }
    secrets.push(token);
    const claims = decodeClaims(token);
    for (const c of checkClaims(claims, kind, now)) {
      out(`${tag} klaim: ${c.name} → ${c.ok ? 'PASS' : 'FAIL'} (${c.detail})`);
      results.push({ who: kind, name: c.name, ok: c.ok });
    }

    // Token diterima Supabase?
    const probe = await rest('rpc/auth_probe', token, { method: 'POST', body: '{}' });
    if (probe.status === 200) {
      const p = probe.body;
      const checks = [
        ['Supabase membaca role = authenticated', p.role === 'authenticated'],
        ['identitas uid = sub token', p.uid === claims.sub],
        [kind === 'anonymous' ? 'provider anonymous terbaca' : 'provider non-anonymous terbaca', kind === 'anonymous' ? p.provider === 'anonymous' : !!p.provider && p.provider !== 'anonymous'],
      ];
      for (const [name, ok] of checks) { out(`${tag} auth_probe: ${name} → ${ok ? 'PASS' : 'FAIL'}`); results.push({ who: kind, name, ok }); }
      out(`${tag} auth_probe: has_teacher_profile=${p.has_teacher_profile} has_student_profile=${p.has_student_profile} (informasi; data produksi masih kosong)`);
    } else if (probe.status === 404 || (probe.body && probe.body.code === 'PGRST202')) {
      out(`${tag} auth_probe belum terpasang (migrasi 20261009000100) → pakai probe tabel`);
      const t = await rest('teacher_profiles?select=user_id&limit=5', token);
      const ok = t.status === 200;
      results.push({ who: kind, name: 'token diterima Supabase (GET teacher_profiles)', ok });
      out(`${tag} GET teacher_profiles → HTTP ${t.status} ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ' — ' + diagnose(t.status, t.body)}`);
    } else {
      results.push({ who: kind, name: 'token diterima Supabase (auth_probe)', ok: false });
      out(`${tag} auth_probe → FAIL — ${diagnose(probe.status, probe.body)}`);
      continue;
    }

    // Isolasi RLS: hanya jumlah baris, tidak pernah isi baris.
    for (const table of ['workspaces', 'students', 'submissions', 'student_login_codes']) {
      const r = await rest(`${table}?select=id&limit=50`, token);
      const n = Array.isArray(r.body) ? r.body.length : null;
      // Data produksi saat ini 0 baris, jadi "0" = konsisten; >0 untuk siswa anonim tanpa profil = FAIL.
      const ok = r.status === 200 && (kind === 'teacher' || n === 0);
      results.push({ who: kind, name: `RLS ${table}`, ok });
      out(`${tag} RLS ${table}: HTTP ${r.status}, baris=${n} → ${ok ? 'PASS' : 'FAIL'}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  out(failed.length ? `HASIL: ${failed.length} GAGAL dari ${results.length}` : `HASIL: ${results.length} lulus`);
  return { exitCode: failed.length ? 1 : 0, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode } = await runVerification({ ...process.env, __ARGV: process.argv.slice(2) });
  process.exit(exitCode);
}
