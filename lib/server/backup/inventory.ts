// Inventaris backup: apa yang diekspor, apa yang sengaja TIDAK, dan alasannya. Dicerminkan dari firestore.rules (hak baca guru):
// hampir semua koleksi dapat dibaca guru mana pun di workspace-nya; catatan siswa/prestasi hanya wali kelas + OWNER/ADMIN;
// profil guru lain hanya OWNER/ADMIN. Server memakai Admin SDK (bypass rules), jadi pembatasan ini DITEGAKKAN ULANG di sini.
export type Role = 'OWNER' | 'ADMIN' | 'TEACHER';

export type Actor = {
  uid: string;
  ws: string;
  role: Role;
  admin: boolean; // OWNER atau ADMIN
  homeroomClassName: string | null;
  workspace: { id: string; name: string | null; plan: string | null };
};

export type CollectionSpec =
  | { name: string; kind: 'workspaceDoc'; strip: string[]; why: string }
  | { name: string; kind: 'teacherProfiles'; why: string }
  | { name: string; kind: 'byWorkspace'; homeroomOnly?: boolean; why: string };

export const EXPORTED: CollectionSpec[] = [
  { name: 'workspaces', kind: 'workspaceDoc', strip: ['inviteCode', 'inviteCodeExpiresAt'], why: 'Kode undangan guru tidak disertakan (rahasia; dapat dibuat ulang di aplikasi).' },
  { name: 'teacher_profiles', kind: 'teacherProfiles', why: 'Guru biasa hanya mengekspor profilnya sendiri; OWNER/ADMIN seluruh anggota workspace.' },
  { name: 'students', kind: 'byWorkspace', why: 'Memuat kode akses siswa (rahasia login siswa) — arsip sebaiknya dienkripsi.' },
  { name: 'schedules', kind: 'byWorkspace', why: '' },
  { name: 'journals', kind: 'byWorkspace', why: '' },
  { name: 'session_skip_reasons', kind: 'byWorkspace', why: '' },
  { name: 'academic_years', kind: 'byWorkspace', why: '' },
  { name: 'attendances', kind: 'byWorkspace', why: '' },
  { name: 'grades', kind: 'byWorkspace', why: '' },
  { name: 'grade_columns', kind: 'byWorkspace', why: '' },
  { name: 'assignments', kind: 'byWorkspace', why: '' },
  { name: 'announcements', kind: 'byWorkspace', why: '' },
  { name: 'submissions', kind: 'byWorkspace', why: '' },
  { name: 'class_fund_transactions', kind: 'byWorkspace', why: '' },
  { name: 'class_inventory', kind: 'byWorkspace', why: '' },
  { name: 'student_notes', kind: 'byWorkspace', homeroomOnly: true, why: 'Catatan konseling: hanya wali kelas untuk kelasnya, atau OWNER/ADMIN.' },
  { name: 'student_achievements', kind: 'byWorkspace', homeroomOnly: true, why: 'Hanya wali kelas untuk kelasnya, atau OWNER/ADMIN.' },
];

export const EXCLUDED: { name: string; reason: string }[] = [
  { name: 'payments', reason: 'Data transaksi pembayaran (Midtrans) bukan data kerja guru; tidak termasuk backup ini.' },
  { name: 'student_login_codes', reason: 'Indeks turunan dari kode akses di dokumen siswa; tidak diekspor (tidak dapat dibaca guru dalam bentuk daftar).' },
  { name: 'student_profiles', reason: 'Tautan akun login siswa (uid Firebase Auth); tidak bermakna di proyek lain dan tidak dapat dipulihkan.' },
  { name: 'workspace_invites', reason: 'Indeks kode undangan (rahasia); dapat dibuat ulang di aplikasi.' },
];

/** Koleksi internal fitur backup sendiri (bukan data pengguna). */
export const INTERNAL = ['backup_exports'];

export const KNOWN_COLLECTIONS = new Set([...EXPORTED.map((c) => c.name), ...EXCLUDED.map((c) => c.name), ...INTERNAL]);

/** Hal yang BELUM tercakup di mana pun (selalu dinyatakan di manifest dan UI). */
export const STANDING_GAPS: { source: string; detail: string }[] = [
  { source: 'firebase_auth', detail: 'Akun login (email guru, akun anonim siswa) tidak termasuk; dipulihkan lewat pendaftaran/kode akses ulang.' },
  { source: 'firebase_storage', detail: 'Berkas di Firebase Storage (mis. lampiran materi tugas lama) tidak diunduh; hanya daftar referensinya di attachments/index.ndjson.' },
  { source: 'supabase_storage', detail: 'Isi file lampiran pengumpulan tugas diunduh terpisah (bagian lampiran), bukan di arsip data ini.' },
  { source: 'restore_ulangan', detail: 'Data Ulangan Harian diekspor sebagai JSON untuk arsip; pemulihan otomatis ke Supabase belum tersedia.' },
];
