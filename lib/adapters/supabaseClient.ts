import { auth } from '@/src/config/firebase';
import { createSupabaseAdapter } from './supabaseAdapter';

// Instance adapter untuk browser: token = ID token Firebase pengguna saat ini
// (guru atau siswa anonim). Jalur autentikasi ini WAJIB terbukti di dashboard
// Supabase (Third-party auth Firebase) sebelum flag koleksi apa pun dinyalakan.
let instance: ReturnType<typeof createSupabaseAdapter> | null = null;

export function getSupabaseAdapter() {
  if (instance) return instance;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error('Konfigurasi Supabase belum lengkap.');
  instance = createSupabaseAdapter({
    url,
    publishableKey,
    getToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
  });
  return instance;
}
