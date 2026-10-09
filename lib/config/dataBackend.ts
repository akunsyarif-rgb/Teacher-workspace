// Pemilih backend data per koleksi. Default SEMUA koleksi memakai Firestore.
// Supabase aktif hanya bila SEMUA syarat terpenuhi:
//   1. koleksi dicantumkan di NEXT_PUBLIC_SUPABASE_COLLECTIONS (dipisah koma), DAN
//   2. koleksi ada di OFFLINE_PARITY_READY (punya padanan perilaku offline Firestore), ATAU
//      NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE=yes (khusus Preview/staging uji — jangan di produksi).
// Tidak ada dual-write: satu koleksi = satu sumber kebenaran pada satu waktu.
//
// Kosong sengaja: aplikasi menjanjikan tulis-offline (OfflineBanner, tab Presensi/Jurnal/Nilai)
// dan adapter Supabase belum punya antrean offline. Isi daftar ini hanya setelah padanannya
// ada, teruji, dan disetujui (docs/MIGRASI-SKIP-REASONS.md).
export const OFFLINE_PARITY_READY: readonly string[] = [];

export function isSupabaseCollection(
  collectionName: string,
  raw: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_COLLECTIONS,
  stagingOverride: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE
) {
  if (!raw) return false;
  const listed = raw.split(',').map((s) => s.trim()).filter(Boolean).includes(collectionName);
  if (!listed) return false;
  return OFFLINE_PARITY_READY.includes(collectionName) || stagingOverride === 'yes';
}
