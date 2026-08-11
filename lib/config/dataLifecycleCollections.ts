import { COLLECTIONS } from './constants';

export type DateFieldFormat = 'dateOnly' | 'isoDateTime';

export type DataLifecycleCollectionConfig = {
  key: string;
  label: string;
  collectionName: string;
  dateField: string;
  dateFormat: DateFieldFormat;
};

// Koleksi yang bisa difilter per periode (bulan/semester/tahun ajaran/dst)
// untuk Arsip, Cleanup (hapus), dan Download Data — lihat
// lib/utils/periodRange.ts. `grades` SENGAJA tidak masuk sini: nilai
// di-upsert (bukan satu dokumen baru per kejadian seperti jurnal/presensi),
// jadi tidak punya field tanggal yang mewakili "kapan nilai ini berlaku"
// secara andal — menghapusnya berdasarkan periode berisiko salah. `grades`
// tetap bisa diekspor (Download Data), tapi hanya lewat scope kelas, bukan
// periode, dan TIDAK pernah ikut Cleanup.
export const DATA_LIFECYCLE_COLLECTIONS: DataLifecycleCollectionConfig[] = [
  { key: 'journals', label: 'Jurnal Mengajar', collectionName: COLLECTIONS.JOURNALS, dateField: 'date', dateFormat: 'dateOnly' },
  { key: 'attendances', label: 'Presensi', collectionName: COLLECTIONS.ATTENDANCES, dateField: 'date', dateFormat: 'dateOnly' },
  { key: 'announcements', label: 'Pengumuman', collectionName: COLLECTIONS.ANNOUNCEMENTS, dateField: 'date', dateFormat: 'dateOnly' },
  { key: 'assignments', label: 'Tugas', collectionName: COLLECTIONS.ASSIGNMENTS, dateField: 'dueDate', dateFormat: 'dateOnly' },
  { key: 'submissions', label: 'Pengumpulan Tugas', collectionName: COLLECTIONS.SUBMISSIONS, dateField: 'submittedAt', dateFormat: 'isoDateTime' },
];

export function getLifecycleCollection(key: string): DataLifecycleCollectionConfig | undefined {
  return DATA_LIFECYCLE_COLLECTIONS.find((c) => c.key === key);
}
