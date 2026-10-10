import type { ServiceRequest } from './ulanganIdentitySink';

// Pembatas laju LINTAS-INSTANCE (durable) berbasis database: RPC public.ulh_rate_hit (jendela tetap per menit; hanya service_role).
// Melengkapi pembatas in-memory per instance (lib/server/ulanganRateLimit.ts), BUKAN menggantikannya: in-memory memotong banjir murah
// sebelum menyentuh database; durable menegakkan batas yang sama di semua instance serverless.
// Batasan jujur: jendela tetap (burst di pergantian menit bisa mencapai ~2× batas); bergantung pada ketersediaan Supabase
// (gagal → ditutup/503, karena sinkronisasi toh butuh Supabase); tidak menghentikan banjir di lapisan jaringan (tiap permintaan tetap
// memanggil fungsi serverless) → untuk itu pakai Vercel Firewall / Firebase App Check.
export type DurableDecision = { ok: true } | { ok: false; reason: 'limited' | 'unavailable' };

export function durableLimits(env: Record<string, string | undefined> = process.env) {
  const num = (v: string | undefined, d: number) => (v && Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : d);
  return {
    // Puncak sah: satu sekolah ±1300 siswa mulai bersamaan, ±1–2 sinkronisasi tiap siswa (dengan retry klien berjeda).
    perUidPerMin: num(env.ULANGAN_SYNC_UID_PER_MIN, 12),
    globalPerMin: num(env.ULANGAN_SYNC_GLOBAL_PER_MIN, 3000),
  };
}

export async function checkDurable(
  uid: string,
  request: ServiceRequest,
  limits: { perUidPerMin: number; globalPerMin: number } = durableLimits()
): Promise<DurableDecision> {
  const hit = (scope: string, key: string, max: number) =>
    request('rpc/ulh_rate_hit', { method: 'POST', body: JSON.stringify({ p_scope: scope, p_key: key, p_window_seconds: 60, p_max: max }) });
  try {
    const [perUid, global] = await Promise.all([hit('sync_uid', uid, limits.perUidPerMin), hit('sync_all', 'all', limits.globalPerMin)]);
    return perUid === true && global === true ? { ok: true } : { ok: false, reason: 'limited' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
