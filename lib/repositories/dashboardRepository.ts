import { activeOnly } from '../utils/softDelete';
import { getDocuments, getDocumentsWhereIn, getAllDocumentsPaged, countDocuments, FIRESTORE_IN_LIMIT } from '../adapters/firestoreAdapter';
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
export async function getJournalsInRange(workspaceId: string, startDate: string, endDate: string, classes?: string[]): Promise<Doc<JournalData>[]> {
  if (!workspaceId) return [];
  return docsByClasses<JournalData>(COLLECTIONS.JOURNALS, [
    ['workspaceId', '==', workspaceId],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ], classes);
}

export async function getAttendancesInRange(workspaceId: string, startDate: string, endDate: string, classes?: string[]): Promise<Doc<AttendanceData>[]> {
  if (!workspaceId) return [];
  return docsByClasses<AttendanceData>(COLLECTIONS.ATTENDANCES, [
    ['workspaceId', '==', workspaceId],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ], classes);
}

export async function getAllSchedulesForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return getAllDocumentsPaged<ScheduleData>(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]]);
}

// Total jurnal — cuma angkanya (kartu statistik), lewat aggregation query. `classes` (nama kelas) membatasi ke kelas
// itu saja (Beranda per guru); tanpa `classes` = seluruh workspace.
async function countByClasses(collectionName: string, base: [string, string, unknown][], classes?: string[]) {
  if (!classes) return countDocuments(collectionName, base);
  if (classes.length === 0) return 0;
  const unique = [...new Set(classes)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += FIRESTORE_IN_LIMIT) chunks.push(unique.slice(i, i + FIRESTORE_IN_LIMIT));
  const counts = await Promise.all(chunks.map((c) => countDocuments(collectionName, [...base, ['className', 'in', c]])));
  return counts.reduce((a, b) => a + b, 0);
}

async function docsByClasses<T extends object>(collectionName: string, base: [string, string, unknown][], classes?: string[]) {
  if (!classes) return getDocuments<T>(collectionName, base);
  if (classes.length === 0) return [];
  return getDocumentsWhereIn<T>(collectionName, base, 'className', classes);
}

export async function getJournalCount(workspaceId: string, classes?: string[]) {
  if (!workspaceId) return 0;
  return countByClasses(COLLECTIONS.JOURNALS, [['workspaceId', '==', workspaceId]], classes);
}

// Beranda hanya butuh dokumen HARI INI untuk status per jadwal; hari-hari sebelumnya cukup angkanya.
export async function getJournalsOnDate(workspaceId: string, date: string, classes?: string[]): Promise<Doc<JournalData>[]> {
  if (!workspaceId) return [];
  return docsByClasses<JournalData>(COLLECTIONS.JOURNALS, [['workspaceId', '==', workspaceId], ['date', '==', date]], classes);
}

export async function getAttendancesOnDate(workspaceId: string, date: string, classes?: string[]): Promise<Doc<AttendanceData>[]> {
  if (!workspaceId) return [];
  return docsByClasses<AttendanceData>(COLLECTIONS.ATTENDANCES, [['workspaceId', '==', workspaceId], ['date', '==', date]], classes);
}

export async function getJournalCountOnDate(workspaceId: string, date: string, classes?: string[]) {
  if (!workspaceId) return 0;
  return countByClasses(COLLECTIONS.JOURNALS, [['workspaceId', '==', workspaceId], ['date', '==', date]], classes);
}

export async function getAttendanceCountOnDate(workspaceId: string, date: string, classes?: string[]) {
  if (!workspaceId) return 0;
  return countByClasses(COLLECTIONS.ATTENDANCES, [['workspaceId', '==', workspaceId], ['date', '==', date]], classes);
}
