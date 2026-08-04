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
};

// Kategori catatan siswa (Konseling, Prestasi, Komunikasi Orang Tua) —
// satu collection dipakai bersama karena bentuk datanya sama persis,
// dibedakan lewat field category ini.
export const STUDENT_NOTE_CATEGORIES = {
  KONSELING: 'konseling',
  PRESTASI: 'prestasi',
  KOMUNIKASI_ORTU: 'komunikasi_ortu',
} as const;

export const ATTENDANCE_STATUS_OPTIONS = ['Hadir', 'Terlambat', 'Sakit', 'Izin', 'Dispensasi', 'Alpa'] as const;

export const DEFAULT_GRADE_COLUMNS = [
  { title: 'Tugas 1', type: 'Tugas' },
  { title: 'Ulangan Harian', type: 'UH' },
  { title: 'Praktik', type: 'Praktek' },
  { title: 'UAS', type: 'UAS' },
];

export const SCHOOL_DAYS_5 = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
export const SCHOOL_DAYS_6 = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
