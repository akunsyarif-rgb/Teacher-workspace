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
  // Tahap yang menggantung tidak pernah memanggil done(), jadi tanpa ini
  // tidak ada jejaknya sama sekali. Penanda ini membuktikan tahap mana yang macet.
  const timers = [3000, 8000].map((ms) => setTimeout(() => recordPerf(`${label} - MASIH MENUNGGU >${ms / 1000}s`, ms), ms));
  try {
    return await fn();
  } finally {
    timers.forEach(clearTimeout);
    done();
  }
}

/** Uji seberapa cepat IndexedDB bisa dibuka (Firestore cache lokal memakainya). */
export function probeIndexedDb() {
  if (typeof indexedDB === 'undefined') return;
  const done = startPerf('probe: buka IndexedDB');
  let opened = false;
  try {
    const req = indexedDB.open('__perf_probe__');
    req.onsuccess = () => {
      opened = true;
      done();
      try { req.result.close(); indexedDB.deleteDatabase('__perf_probe__'); } catch {}
    };
    req.onerror = () => recordPerf('probe: IndexedDB ERROR', 0);
    req.onblocked = () => recordPerf('probe: IndexedDB BLOCKED', 0);
    setTimeout(() => { if (!opened) recordPerf('probe: IndexedDB belum terbuka >3s', 3000); }, 3000);
  } catch {
    recordPerf('probe: IndexedDB exception', 0);
  }
}

/** Waktu sejak halaman mulai dimuat (mis. "auth siap di 2300ms"). */
export function markSinceNavigation(label: string) {
  if (typeof performance === 'undefined') return;
  recordPerf(label, performance.now());
}
