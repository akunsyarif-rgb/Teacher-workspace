/**
 * Pengukuran waktu per tahap — hanya mencatat, tidak mengubah perilaku.
 * Hasil: console.info "[perf] label: Xms" + window.__perf (untuk overlay
 * ?perf=1 di PerfOverlay). Tidak memuat data siswa/token apa pun, hanya
 * label tahap dan durasi.
 */
export type PerfEntry = { label: string; ms: number; at: number };

const MAX_ENTRIES = 60;

export function recordPerf(label: string, ms: number) {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __perf?: PerfEntry[] };
  const entry = { label, ms: Math.round(ms), at: Math.round(performance.now()) };
  w.__perf = [...(w.__perf || []), entry].slice(-MAX_ENTRIES);
  console.info(`[perf] ${label}: ${entry.ms}ms`);
  window.dispatchEvent(new Event('perf-update'));
}

/** Mulai timer; panggil fungsi yang dikembalikan saat tahap selesai. */
export function startPerf(label: string) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  return () => {
    if (typeof performance === 'undefined') return 0;
    const ms = performance.now() - t0;
    recordPerf(label, ms);
    return ms;
  };
}

/** Ukur satu promise. Error tetap dilempar; durasi tetap dicatat. */
export async function measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const done = startPerf(label);
  try {
    return await fn();
  } finally {
    done();
  }
}

/** Waktu sejak halaman mulai dimuat (mis. "auth siap di 2300ms"). */
export function markSinceNavigation(label: string) {
  if (typeof performance === 'undefined') return;
  recordPerf(label, performance.now());
}
