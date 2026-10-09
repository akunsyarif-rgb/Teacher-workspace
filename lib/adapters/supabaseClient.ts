import { auth } from '@/src/config/firebase';
import { createSupabaseAdapter, SupabaseAdapterError } from './supabaseAdapter';
import { indexedDbStore, withOfflineSupport, type OfflineAdapter } from './offlineLayer';

// Instance adapter untuk browser: token = ID token Firebase pengguna saat ini (guru atau siswa anonim),
// dibungkus lapisan offline (cache baca + outbox tulis) yang DIPISAH PER PENGGUNA (nama IndexedDB memuat uid),
// agar perangkat bersama tidak mencampur data atau antrean antar-akun.
// Jalur autentikasi WAJIB terbukti di dashboard Supabase (Third-Party Auth Firebase + claim role) sebelum
// flag koleksi apa pun dinyalakan.
let current: { uid: string; adapter: OfflineAdapter; dispose: () => void } | null = null;

export function getSupabaseAdapter(): OfflineAdapter {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new SupabaseAdapterError('auth', 'Belum login: adapter Supabase tidak tersedia.');
  if (current?.uid === uid) return current.adapter;
  current?.dispose();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new SupabaseAdapterError('bad_request', 'Konfigurasi Supabase belum lengkap.');

  const base = createSupabaseAdapter({
    url,
    publishableKey,
    getToken: async (forceRefresh) => (auth.currentUser ? auth.currentUser.getIdToken(forceRefresh === true) : null),
  });
  const adapter = withOfflineSupport(base, {
    store: indexedDbStore(`tw-supabase-${uid}`),
    isOnline: () => !(typeof navigator !== 'undefined' && navigator.onLine === false),
  });

  // Kirim ulang antrean saat online kembali, saat dimuat, dan berkala selagi ada antrean.
  const flush = () => { void adapter.flush().catch(() => {}); };
  let timer: ReturnType<typeof setInterval> | undefined;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', flush);
    timer = setInterval(flush, 30_000);
    flush();
  }
  current = {
    uid,
    adapter,
    dispose: () => {
      if (typeof window !== 'undefined') window.removeEventListener('online', flush);
      if (timer) clearInterval(timer);
    },
  };
  return adapter;
}
