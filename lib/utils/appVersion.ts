// Logika murni pengecekan versi aplikasi di klien (UI-nya di src/components/ui/UpdateBanner.tsx).

/** Klien basi bila kedua versi diketahui dan berbeda. Versi kosong/tak diketahui = jangan ganggu pengguna. */
export function isStaleClient(local: string | null | undefined, remote: string | null | undefined): boolean {
  if (!local || !remote) return false;
  return local !== remote;
}

/** Batasi frekuensi pengecekan (fokus/navigasi bisa terjadi beruntun). */
export function shouldCheckNow(lastCheckedAt: number, now: number, minIntervalMs: number): boolean {
  return now - lastCheckedAt >= minIntervalMs;
}

export function parseVersionResponse(body: unknown): string | null {
  const v = (body as { version?: unknown } | null)?.version;
  return typeof v === 'string' && v.length > 0 ? v : null;
}
