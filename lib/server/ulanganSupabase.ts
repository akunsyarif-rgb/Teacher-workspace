// Panggilan RPC Supabase untuk Ulangan Harian — SERVER ONLY (hanya diimpor route handler). Mandiri: tidak bergantung pada modul Supabase PR lain.
//  - Hanya fungsi berawalan `ulh_` yang boleh dipanggil (secret key tidak bisa dipakai untuk fungsi/tabel lain lewat jalur ini).
//  - Secret key hanya dari env server, hanya dikirim sebagai header ke URL project yang divalidasi; tidak pernah masuk pesan galat/log.
//  - Project SmadaExam selalu ditolak. URL http hanya diizinkan untuk gateway lokal bila Firestore Emulator aktif (env itu tidak ada di Vercel).
const SMADA_REF = 'abdkrhmxfpcmgzsxzfyz';
const TIMEOUT_MS = 15_000;

export class UlanganDbError extends Error {
  constructor(message: string, public status: number, public code?: string, public kind: 'config' | 'network' | 'db' = 'db') {
    super(message);
    this.name = 'UlanganDbError';
  }
}

export function ulanganSupabaseConfig(env: Record<string, string | undefined> = process.env) {
  const raw = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  let origin = '';
  try { origin = new URL(raw).origin; } catch { /* kosong/tak valid */ }
  const local = !!env.FIRESTORE_EMULATOR_HOST && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin);
  const ref = origin.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if ((!ref && !local) || !key) throw new UlanganDbError('server_config', 503, undefined, 'config');
  if (ref === SMADA_REF) throw new UlanganDbError('server_config', 503, undefined, 'config');
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
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
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
    const b = (body && typeof body === 'object' ? body : {}) as { message?: string; code?: string };
    throw new UlanganDbError(String(b.message ?? `HTTP ${res.status}`).slice(0, 200), res.status, b.code);
  }
  return body;
}
