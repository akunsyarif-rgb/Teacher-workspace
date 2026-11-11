// Cache persisten di perangkat (localStorage) — bertahan antar-reload, beda dari sessionCache (memori, hilang saat reload).
// Dua "namespace" dengan umur berbeda:
//  - `cache`: data turunan yang boleh basi sampai TTL (mis. daftar kelas untuk Beranda). DIBUANG oleh clearAllCached()
//    (lib/utils/sessionCache.ts), yakni setiap kali guru mengubah data di perangkat ini.
//  - `sync` : keadaan sinkronisasi bertahap (mis. riwayat presensi siswa). TIDAK dibuang oleh clearAllCached();
//    dikelola oleh pemiliknya (lihat lib/utils/attendanceSync.ts).
// Semua akses dibungkus try/catch: mode privat/penyimpanan penuh/SSR membuat cache ini no-op, dan pemanggil jatuh ke
// pembacaan Firestore seperti sebelumnya (tidak ada perubahan perilaku, hanya tanpa penghematan).
type Entry<T> = { t: number; v: T };

export type PersistentStore = {
  get<T>(key: string, ttlMs?: number, now?: number): T | undefined;
  set<T>(key: string, value: T, now?: number): void;
  remove(key: string): void;
  keys(prefix?: string): string[];
  clear(): void;
};

let storageOverride: Storage | null | undefined;

/** Untuk pengujian: ganti penyimpanan (null = tidak tersedia). */
export function setPersistentStorageForTests(storage: Storage | null | undefined) {
  storageOverride = storage;
}

function storage(): Storage | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis ? (globalThis as { localStorage: Storage }).localStorage : null;
  } catch {
    return null;
  }
}

export function createPersistentStore(prefix: string): PersistentStore {
  return {
    get<T>(key: string, ttlMs?: number, now: number = Date.now()): T | undefined {
      try {
        const raw = storage()?.getItem(prefix + key);
        if (!raw) return undefined;
        const entry = JSON.parse(raw) as Entry<T>;
        if (typeof entry?.t !== 'number') return undefined;
        if (ttlMs !== undefined && now - entry.t > ttlMs) return undefined;
        return entry.v;
      } catch {
        return undefined;
      }
    },
    set<T>(key: string, value: T, now: number = Date.now()) {
      try {
        storage()?.setItem(prefix + key, JSON.stringify({ t: now, v: value } satisfies Entry<T>));
      } catch {
        // penyimpanan penuh / dilarang: abaikan
      }
    },
    remove(key: string) {
      try {
        storage()?.removeItem(prefix + key);
      } catch {
        // abaikan
      }
    },
    keys(keyPrefix = '') {
      try {
        const s = storage();
        if (!s) return [];
        const out: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k && k.startsWith(prefix + keyPrefix)) out.push(k.slice(prefix.length));
        }
        return out;
      } catch {
        return [];
      }
    },
    clear() {
      try {
        const s = storage();
        if (!s) return;
        const doomed: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k && k.startsWith(prefix)) doomed.push(k);
        }
        doomed.forEach((k) => s.removeItem(k));
      } catch {
        // abaikan
      }
    },
  };
}

export const derivedCache = createPersistentStore('tw:cache:v1:');
export const syncStore = createPersistentStore('tw:sync:v1:');

/** Baca dari cache persisten bila masih segar (TTL), kalau tidak ambil dan simpan. */
export async function withPersistentCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = derivedCache.get<T>(key, ttlMs);
  if (hit !== undefined) return hit;
  const data = await fetcher();
  derivedCache.set(key, data);
  return data;
}

/** Hapus SEMUA data cache/sinkron di perangkat — dipanggil saat keluar akun supaya perangkat bersama tidak menyimpan data sekolah. */
export function clearPersistentData() {
  derivedCache.clear();
  syncStore.clear();
}
