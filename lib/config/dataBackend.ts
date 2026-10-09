// Pemilih backend data per koleksi. Default SEMUA koleksi memakai Firestore.
// Supabase hanya aktif bila koleksi dicantumkan eksplisit di
// NEXT_PUBLIC_SUPABASE_COLLECTIONS (daftar dipisah koma), mis. "session_skip_reasons".
// Tidak ada dual-write: satu koleksi = satu sumber kebenaran pada satu waktu.
// Jangan aktifkan di produksi sebelum backfill + verifikasi (docs/MIGRASI-SUPABASE.md).
export function isSupabaseCollection(
  collectionName: string,
  raw: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_COLLECTIONS
) {
  if (!raw) return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(collectionName);
}
