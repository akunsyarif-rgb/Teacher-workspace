// Modul Ulangan Harian: seluruh datanya di Supabase (bukan Firestore). Modul dimatikan secara default; menyalakannya
// butuh NEXT_PUBLIC_ULANGAN_ENABLED=yes DAN identitas guru/siswa sudah tersedia di Supabase (teacher_profiles /
// student_profiles — lihat docs/ULANGAN-HARIAN.md). Flag ini hanya menyembunyikan UI; keamanan ada di RLS/RPC server.
export function isUlanganEnabled(raw: string | undefined = process.env.NEXT_PUBLIC_ULANGAN_ENABLED) {
  return raw === 'yes';
}

// Keluar dari halaman ujian baru dihitung bila LEBIH dari ambang ini (server menegakkan ambang yang sama).
export const INTEGRITY_LEAVE_THRESHOLD_MS = 3000;
export const AUTOSAVE_DEBOUNCE_MS = 400;
