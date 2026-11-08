import { getDocuments, getAllDocumentsPaged, getDocumentsPage, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import type { Doc, DocumentsPage } from '../adapters/firestoreAdapter';
import type { ScheduleData } from '../types/models';
import { COLLECTIONS } from '../config/constants';

// Jadwal bersifat mingguan dan berulang (bukan riwayat), tapi tetap diambil bertahap
// supaya satu workspace besar (banyak guru x banyak kelas) tidak jadi satu respons raksasa.
export async function getAllSchedules(workspaceId: string): Promise<Doc<ScheduleData>[]> {
  if (!workspaceId) return [];
  return getAllDocumentsPaged<ScheduleData>(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]]);
}

export async function getSchedulesPage(
  workspaceId: string,
  options: { pageSize?: number; cursor?: string | null } = {}
): Promise<DocumentsPage<ScheduleData>> {
  if (!workspaceId) return { docs: [], nextCursor: null };
  return getDocumentsPage<ScheduleData>(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]], options);
}

// Dipakai Student Companion. Filter className bukan cuma demi efisiensi:
// rules siswa mensyaratkan workspaceId + className cocok dengan profilnya,
// dan query list baru diizinkan Firestore kalau filternya menjamin itu —
// getAllSchedules (workspaceId saja) akan ditolak untuk siswa.
export async function getSchedulesByClass(workspaceId: string, className: string): Promise<Doc<ScheduleData>[]> {
  if (!workspaceId || !className) return [];
  return getDocuments<ScheduleData>(COLLECTIONS.SCHEDULES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createSchedule(workspaceId: string, data: Record<string, any>) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  return addDocument(COLLECTIONS.SCHEDULES, { ...data, workspaceId });
}

export async function deleteSchedule(id: string) {
  return deleteDocument(COLLECTIONS.SCHEDULES, id);
}
