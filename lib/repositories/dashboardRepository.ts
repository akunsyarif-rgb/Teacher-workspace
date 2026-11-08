import { activeOnly } from '../utils/softDelete';
import { getDocuments, getAllDocumentsPaged, countDocuments } from '../adapters/firestoreAdapter';
import type { Doc } from '../adapters/firestoreAdapter';
import type { StudentData, ScheduleData, JournalData, AttendanceData } from '../types/models';
import { COLLECTIONS } from '../config/constants';

export async function getAllStudentsForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return activeOnly(await getAllDocumentsPaged<StudentData>(COLLECTIONS.STUDENTS, [['workspaceId', '==', workspaceId]]));
}

// Cuma rentang tanggal yang diminta (dipakai untuk 7 hari terakhir), BUKAN
// seluruh riwayat jurnal workspace — sebelumnya ringkasan dashboard
// mengunduh SEMUA jurnal & presensi sejak awal dipakai, yang berarti makin
// lambat terus tiap hari seiring bertambahnya data (ini akar masalah
// keluhan "loading lama"). Beda dengan riwayat per-kelas di halaman
// Presensi yang memang sengaja menampilkan semua pertemuan.
export async function getJournalsInRange(workspaceId: string, startDate: string, endDate: string): Promise<Doc<JournalData>[]> {
  if (!workspaceId) return [];
  return getDocuments<JournalData>(COLLECTIONS.JOURNALS, [
    ['workspaceId', '==', workspaceId],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ]);
}

export async function getAttendancesInRange(workspaceId: string, startDate: string, endDate: string): Promise<Doc<AttendanceData>[]> {
  if (!workspaceId) return [];
  return getDocuments<AttendanceData>(COLLECTIONS.ATTENDANCES, [
    ['workspaceId', '==', workspaceId],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ]);
}

export async function getAllSchedulesForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return getAllDocumentsPaged<ScheduleData>(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]]);
}

// Total jurnal sepanjang masa — cuma angkanya (dipakai untuk kartu
// statistik), lewat aggregation query supaya tidak perlu mengunduh isi
// semua dokumen hanya untuk menghitung jumlahnya.
export async function getJournalCount(workspaceId: string) {
  if (!workspaceId) return 0;
  return countDocuments(COLLECTIONS.JOURNALS, [['workspaceId', '==', workspaceId]]);
}
