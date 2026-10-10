// Pembatas laju in-memory untuk endpoint sinkronisasi identitas. BEST-EFFORT per instance serverless: menahan banjir dari satu
// akun dan membatasi total beban per instance; BUKAN pengganti pembatas lintas-instance (Vercel Firewall / Firebase App Check).
// Memori dibatasi: kunci kedaluwarsa dibuang dan jumlah kunci dibatasi (akun anonim Firebase bisa dibuat siapa saja).
export function createLimiter(opts: { perKeyMs: number; globalMax: number; windowMs: number; maxKeys?: number }) {
  const last = new Map<string, number>();
  let windowStart = 0;
  let windowCount = 0;
  const maxKeys = opts.maxKeys ?? 5000;

  return function check(key: string, now: number = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
    if (now - windowStart >= opts.windowMs) { windowStart = now; windowCount = 0; }
    const prev = last.get(key);
    if (prev !== undefined && now - prev < opts.perKeyMs) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((opts.perKeyMs - (now - prev)) / 1000)) };
    }
    if (windowCount >= opts.globalMax) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((opts.windowMs - (now - windowStart)) / 1000)) };
    }
    windowCount += 1;
    if (last.size >= maxKeys) {
      for (const [k, t] of last) if (now - t >= opts.perKeyMs) last.delete(k);
      while (last.size >= maxKeys) last.delete(last.keys().next().value as string); // terlama (urutan sisip)
    }
    last.delete(key); // pindah ke ujung agar urutan sisip = urutan terbaru
    last.set(key, now);
    return { ok: true };
  };
}
