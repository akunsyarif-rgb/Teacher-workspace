import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAllStudentsForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return adapterFor(COLLECTIONS.STUDENTS).getDocuments(COLLECTIONS.STUDENTS, [['workspaceId', '==', workspaceId]]);
}

// Cuma rentang tanggal yang diminta (dipakai untuk 7 hari terakhir), BUKAN
// seluruh riwayat jurnal workspace — sebelumnya ringkasan dashboard
// mengunduh SEMUA jurnal & presensi sejak awal dipakai, yang berarti makin
// lambat terus tiap hari seiring bertambahnya data (ini akar masalah
// keluhan "loading lama"). Beda dengan riwayat per-kelas di halaman
// Presensi yang memang sengaja menampilkan semua pertemuan.
export async function getJournalsInRange(workspaceId: string, startDate: string, endDate: string) {
  if (!workspaceId) return [];
  return adapterFor(COLLECTIONS.JOURNALS).getDocuments(COLLECTIONS.JOURNALS, [
    ['workspaceId', '==', workspaceId],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ]);
}

export async function getAttendancesInRange(workspaceId: string, startDate: string, endDate: string) {
  if (!workspaceId) return [];
  return adapterFor(COLLECTIONS.ATTENDANCES).getDocuments(COLLECTIONS.ATTENDANCES, [
    ['workspaceId', '==', workspaceId],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ]);
}

export async function getAllSchedulesForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return adapterFor(COLLECTIONS.SCHEDULES).getDocuments(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]]);
}

// Total jurnal sepanjang masa — cuma angkanya (dipakai untuk kartu
// statistik), lewat aggregation query supaya tidak perlu mengunduh isi
// semua dokumen hanya untuk menghitung jumlahnya.
export async function getJournalCount(workspaceId: string) {
  if (!workspaceId) return 0;
  return adapterFor(COLLECTIONS.JOURNALS).countDocuments(COLLECTIONS.JOURNALS, [['workspaceId', '==', workspaceId]]);
}
