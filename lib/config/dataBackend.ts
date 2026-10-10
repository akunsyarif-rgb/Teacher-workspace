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
// Koleksi siswa-facing butuh gerbang auth siswa tambahan (STUDENT_FACING); students+student_login_codes satu unit (UNITS).
export const OFFLINE_PARITY_READY: readonly string[] = [
  'session_skip_reasons',
  'academic_years',
  'class_fund_transactions',
  'class_inventory',
  'student_notes',
  'schedules',
  'grade_columns',
  'grades',
  'student_achievements',
  'journals',
  'attendances',
  'announcements',
  'assignments',
  'submissions',
  'students',
  'student_login_codes',
  'student_profiles',
];

// Koleksi yang dibaca/ditulis juga oleh SESI SISWA (anonim). Flag deployment berlaku untuk semua sesi, jadi koleksi ini
// tambahan butuh NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED=yes — set HANYA setelah token siswa anonim terbukti diterima Supabase
// (Third-Party Auth + claim role) dan RLS siswa teruji di staging (scripts/supabase/verify-auth.mjs).
export const STUDENT_FACING: readonly string[] = [
  'schedules', 'grade_columns', 'grades', 'student_achievements', 'announcements', 'assignments',
  'attendances', 'submissions', 'students', 'student_login_codes', 'student_profiles',
];

// Unit atomik: dibuat dalam satu batch lintas koleksi (createStudent*), jadi harus beralih BERSAMAAN atau tidak sama sekali.
const UNITS: readonly (readonly string[])[] = [['students', 'student_login_codes', 'student_profiles']];

export function isSupabaseCollection(
  collectionName: string,
  raw: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_COLLECTIONS,
  stagingOverride: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE,
  studentAuthVerified: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED
) {
  if (!raw) return false;
  const listed = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  const ok = (c: string) =>
    listed.has(c) &&
    (OFFLINE_PARITY_READY.includes(c) || stagingOverride === 'yes') &&
    (!STUDENT_FACING.includes(c) || studentAuthVerified === 'yes');
  const unit = UNITS.find((u) => u.includes(collectionName));
  return unit ? unit.every(ok) : ok(collectionName);
}
