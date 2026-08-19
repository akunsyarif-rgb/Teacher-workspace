export const COLLECTIONS = {
  STUDENTS: 'students',
  JOURNALS: 'journals',
  ATTENDANCES: 'attendances',
  GRADES: 'grades',
  GRADE_COLUMNS: 'grade_columns',
  SCHEDULES: 'schedules',
  CLASS_FUND: 'class_fund_transactions',
  CLASS_INVENTORY: 'class_inventory',
  STUDENT_NOTES: 'student_notes',
  ASSIGNMENTS: 'assignments',
  SUBMISSIONS: 'submissions',
  ANNOUNCEMENTS: 'announcements',
  STUDENT_LOGIN_CODES: 'student_login_codes',
  STUDENT_PROFILES: 'student_profiles',
  // Prestasi sengaja TIDAK ikut student_notes. Lihat komentar panjang di
  // firestore.rules: student_notes memuat catatan konseling, dan prestasi
  // adalah satu-satunya kategori yang perlu dibaca siswa.
  STUDENT_ACHIEVEMENTS: 'student_achievements',
  // Alasan guru tidak sempat mengajar sesi tertentu ("Penyesuaian Workflow
  // Jadwal — Final" #3) — satu dokumen per (scheduleId, date). Bukan
  // presensi/jurnal pengganti (field-nya tidak disentuh), tapi begitu
  // tersimpan, sesi ini resmi berstatus "Tidak Mengajar" (lihat
  // TodayClassStatus.isSkipped di dashboardService) — tidak lagi dihitung
  // sebagai pekerjaan belum selesai, tetap tersimpan permanen sebagai
  // histori.
  SESSION_SKIP_REASONS: 'session_skip_reasons',
  // Tahun Ajaran — partisi BERBASIS TANGGAL, bukan tag di tiap dokumen.
  // Satu dokumen per tahun ajaran {label, startDate, endDate, isActive}.
  // Data lain (journals/attendances/dst) TIDAK dapat field baru — status
  // "milik tahun mana" murni dihitung dari field date/createdAt mereka
  // yang sudah ada, dicocokkan ke rentang startDate..endDate di sini. Lihat
  // lib/utils/periodRange.ts.
  ACADEMIC_YEARS: 'academic_years',
};

// Alasan guru tidak mengajar sesi terjadwal — dipakai di Beranda saat
// mengonfirmasi sesi berstatus "Perlu Konfirmasi".
export const SESSION_SKIP_REASONS = {
  RAPAT: 'Rapat',
  TUGAS_DINAS: 'Tugas dinas',
  KEGIATAN_SEKOLAH: 'Kegiatan sekolah',
  LAINNYA: 'Lainnya',
} as const;

// Status pengumpulan tugas seorang siswa untuk satu assignment. Tidak ada
// dokumen submission = otomatis BELUM_MENGUMPULKAN (tidak perlu pre-create
// dokumen kosong untuk tiap siswa).
export const SUBMISSION_STATUS = {
  BELUM_MENGUMPULKAN: 'belum_mengumpulkan',
  MENUNGGU_PENILAIAN: 'menunggu_penilaian',
  DINILAI: 'dinilai',
} as const;

// Kategori catatan siswa (Konseling, Prestasi, Komunikasi Orang Tua) —
// satu collection dipakai bersama karena bentuk datanya sama persis,
// dibedakan lewat field category ini.
export const STUDENT_NOTE_CATEGORIES = {
  KONSELING: 'konseling',
  PRESTASI: 'prestasi',
  KOMUNIKASI_ORTU: 'komunikasi_ortu',
} as const;

// "Terlambat" bukan status sendiri — itu atribut tambahan (late: boolean)
// di atas status Hadir, supaya statistik kehadiran tetap terhitung hadir.
// Lihat detail/late di attendanceService.
export const ATTENDANCE_STATUS_OPTIONS = ['Hadir', 'Sakit', 'Izin', 'Dispensasi', 'Alpa'] as const;

export const DEFAULT_GRADE_COLUMNS = [
  { title: 'Tugas 1', type: 'Tugas' },
  { title: 'Ulangan Harian', type: 'UH' },
  { title: 'Praktik', type: 'Praktek' },
  { title: 'UAS', type: 'UAS' },
];

export const SCHOOL_DAYS_5 = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
export const SCHOOL_DAYS_6 = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
