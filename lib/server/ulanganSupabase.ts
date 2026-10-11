// Panggilan RPC Supabase untuk Ulangan Harian — SERVER ONLY (hanya diimpor route handler). Mandiri: tidak bergantung pada modul Supabase PR lain.
//  - Hanya fungsi berawalan `ulh_` yang boleh dipanggil (secret key tidak bisa dipakai untuk fungsi/tabel lain lewat jalur ini).
//  - Secret key hanya dari env server, hanya dikirim sebagai header ke URL project yang divalidasi; tidak pernah masuk pesan galat/log.
//  - Project SmadaExam selalu ditolak. URL http hanya diizinkan untuk gateway lokal bila Firestore Emulator aktif (env itu tidak ada di Vercel).
const SMADA_REF = 'abdkrhmxfpcmgzsxzfyz';
const TIMEOUT_MS = 15_000;

export class UlanganDbError extends Error {
  constructor(message: string, public status: number, public code?: string, public kind: 'config' | 'network' | 'db' = 'db', public hint?: string) {
    super(message);
    this.name = 'UlanganDbError';
  }
}

const JWT_RE = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
function jwtClaims(key: string): { role?: string; ref?: string } {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

/**
 * Header ke gateway Supabase. Key baru (`sb_secret_…`) BUKAN JWT: dikirim hanya lewat `apikey`; gateway yang menukarnya
 * menjadi JWT service_role. Mengirimnya juga sebagai `Authorization: Bearer` berisiko ditolak sebagai "bukan JWT" (HTTP 401).
 * Key legacy (JWT service_role) tetap dikirim di kedua header seperti klien Supabase.
 */
export function ulanganAuthHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', apikey: key };
  if (JWT_RE.test(key)) h.Authorization = `Bearer ${key}`;
  return h;
}

// Penyebab penolakan hulu → label konstan (tanpa meneruskan teks asli yang bisa memuat URL/kunci).
function upstreamHint(b: { message?: string; hint?: string; code?: string }): string {
  const t = `${b.message ?? ''} ${b.hint ?? ''}`;
  if (/invalid api key/i.test(t)) return 'invalid_api_key';
  if (/jwt expired/i.test(t)) return 'jwt_expired';
  if (/invalid jwt|jws|jwt|not a jwt|bearer/i.test(t)) return 'invalid_jwt';
  if (/permission denied/i.test(t)) return 'permission_denied';
  if (/could not find the function|PGRST202/i.test(`${t} ${b.code ?? ''}`)) return 'function_missing';
  return '';
}

// Ciri bentuk URL (bukan nilainya) untuk diagnosa env di Vercel: panjang, skema, kutip/spasi, akhiran host.
function urlShape(raw: string, origin: string): string {
  const f: string[] = [];
  if (!/^https:\/\//i.test(raw)) f.push(/^http:\/\//i.test(raw) ? 'http' : 'noscheme');
  if (/["'`]/.test(raw)) f.push('quote');
  if (/\s/.test(raw)) f.push('space');
  if (!/\.supabase\.co(\/|$)/i.test(raw)) f.push('nothost');
  const ref = origin.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];
  if (ref !== undefined) f.push(`ref${ref.length}${/[A-Z]/.test(ref) ? 'upper' : ''}`);
  return (f.join('_') || 'other').replace(/[^a-z0-9_]/g, '');
}

export function ulanganSupabaseConfig(env: Record<string, string | undefined> = process.env) {
  const raw = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  let origin = '';
  try { origin = new URL(raw).origin; } catch { /* kosong/tak valid */ }
  const local = !!env.FIRESTORE_EMULATOR_HOST && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin);
  const ref = origin.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  // Kode konstan (tanpa nilai env) agar penyebab konfigurasi terbaca tanpa membuka log.
  if (!raw) throw new UlanganDbError('server_config_url_missing', 503, undefined, 'config');
  if (ref === SMADA_REF) throw new UlanganDbError('server_config_url_smadaexam', 503, undefined, 'config');
  if (!ref && !local) throw new UlanganDbError(`server_config_url_invalid_${urlShape(raw, origin)}`, 503, undefined, 'config');
  if (!key) throw new UlanganDbError('server_config_key_missing', 503, undefined, 'config');
  // Salah jenis key = penyebab 401 yang umum: publishable/anon tidak boleh dipakai di server untuk RPC ini.
  if (/^sb_publishable_/.test(key)) throw new UlanganDbError('server_config_key_publishable', 503, undefined, 'config');
  if (JWT_RE.test(key)) {
    const c = jwtClaims(key);
    if (c.role && c.role !== 'service_role') throw new UlanganDbError('server_config_key_not_service', 503, undefined, 'config');
    if (c.ref && ref && c.ref !== ref) throw new UlanganDbError('server_config_key_wrong_project', 503, undefined, 'config');
  }
  return { url: origin, key };
}

export async function ulanganRpc(
  name: string,
  args: Record<string, unknown>,
  deps: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}
): Promise<unknown> {
  if (!/^ulh_[a-z_]{1,60}$/.test(name)) throw new UlanganDbError('forbidden_rpc', 400, '22023');
  const { url, key } = ulanganSupabaseConfig(deps.env);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: ulanganAuthHeaders(key),
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
  } catch {
    throw new UlanganDbError('network', 502, undefined, 'network'); // pesan asli (bisa memuat URL/host) sengaja tidak diteruskan
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok) {
    const b = (body && typeof body === 'object' ? body : {}) as { message?: string; code?: string; hint?: string };
    throw new UlanganDbError(String(b.message ?? `HTTP ${res.status}`).slice(0, 200), res.status, b.code, 'db', upstreamHint(b as { message?: string; hint?: string; code?: string }));
  }
  return body;
}
