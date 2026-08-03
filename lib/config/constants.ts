export const COLLECTIONS = {
  STUDENTS: 'students',
  JOURNALS: 'journals',
  ATTENDANCES: 'attendances',
  GRADES: 'grades',
  GRADE_COLUMNS: 'grade_columns',
  SCHEDULES: 'schedules',
  CLASS_FUND: 'class_fund_transactions',
};

export const ATTENDANCE_STATUS_OPTIONS = ['Hadir', 'Sakit', 'Izin', 'Dispensasi', 'Alpa'] as const;

export const DEFAULT_GRADE_COLUMNS = [
  { title: 'Tugas 1', type: 'Tugas' },
  { title: 'Ulangan Harian', type: 'UH' },
  { title: 'Praktik', type: 'Praktek' },
  { title: 'UAS', type: 'UAS' },
];

export const SCHOOL_DAYS_5 = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
export const SCHOOL_DAYS_6 = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
