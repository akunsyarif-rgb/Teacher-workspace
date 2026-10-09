// Pemilih backend data per koleksi. Default SEMUA koleksi memakai Firestore.
// Supabase aktif hanya bila SEMUA syarat terpenuhi:
//   1. koleksi dicantumkan di NEXT_PUBLIC_SUPABASE_COLLECTIONS (dipisah koma), DAN
//   2. koleksi ada di OFFLINE_PARITY_READY (punya padanan perilaku offline Firestore), ATAU
//      NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE=yes (khusus Preview/staging uji — jangan di produksi).
// Tidak ada dual-write: satu koleksi = satu sumber kebenaran pada satu waktu.
//
// OFFLINE_PARITY_READY = koleksi yang sudah punya padanan perilaku offline Firestore lewat lapisan offline
// (lib/adapters/offlineLayer.ts: cache baca + outbox tulis idempoten) DAN pemetaan kolom + RLS teruji.
// Ini hanya "kesiapan kode"; SAKLAR-nya tetap NEXT_PUBLIC_SUPABASE_COLLECTIONS (default kosong).
// Sengaja TIDAK masuk: students/student_login_codes/submissions (batch lintas koleksi + klaim akses siswa) dan koleksi yang
// disentuh langsung oleh Arsip/Cleanup/Export berbasis Firestore (journals, attendances, announcements, assignments).
export const OFFLINE_PARITY_READY: readonly string[] = [
  'session_skip_reasons',
  'academic_years',
  'class_fund_transactions',
  'class_inventory',
  'student_notes',
  'schedules',
  'grade_columns',
  // Butuh migrasi RPC 20261009000200_batch_write.sql (PR #59) terpasang di Supabase sebelum flag dinyalakan.
  'grades',
  'student_achievements',
];

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
