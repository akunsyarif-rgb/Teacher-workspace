/**
 * Cache in-memory sederhana untuk data yang jarang berubah (daftar kelas,
 * jadwal, ringkasan dashboard) supaya berpindah menu berulang dalam satu
 * sesi tidak selalu menunggu round-trip Firestore baru. Bukan solusi
 * offline — hanya hidup selama tab ini terbuka (reset saat reload penuh)
 * dan dibersihkan total setiap ada perubahan data (lihat clearAllCached),
 * supaya tidak pernah menampilkan data basi setelah guru menyimpan sesuatu.
 */

type CacheEntry<T> = { data: T; timestamp: number };

const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 60_000;

export function getCached<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Panggil setelah operasi tulis apa pun (tambah/hapus siswa, jadwal,
 * presensi, jurnal, nilai) supaya baca berikutnya pasti fresh dari server.
 * Sengaja membersihkan semua entri, bukan hanya yang terkait, karena jauh
 * lebih murah dan lebih aman daripada melacak ketergantungan setiap kunci.
 */
export function clearAllCached(): void {
  cache.clear();
}

// Monitoring PALING sederhana yang mungkin: hampir semua fetch data di
// aplikasi ini lewat withCache (dipanggil dari controller), jadi satu
// titik ini saja cukup untuk melihat query mana yang lambat — tanpa
// menambah dependency atau membungkus setiap pemanggil satu per satu.
// Cuma aktif di dev (console.debug, bukan console.log, supaya gampang
// disaring) dan cuma untuk cache MISS — cache HIT sudah pasti cepat,
// tidak ada gunanya diukur.
const SLOW_FETCH_THRESHOLD_MS = 800;

export async function withCache<T>(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
  const cached = getCached<T>(key, ttlMs);
  if (cached !== undefined) return cached;

  const start = process.env.NODE_ENV !== 'production' ? performance.now() : 0;
  const data = await fetcher();
  if (process.env.NODE_ENV !== 'production') {
    const elapsed = performance.now() - start;
    if (elapsed >= SLOW_FETCH_THRESHOLD_MS) {
      console.debug(`[perf] ${key} — ${elapsed.toFixed(0)}ms`);
    }
  }
  setCached(key, data);
  return data;
}
