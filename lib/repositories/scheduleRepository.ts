import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAllSchedules(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]]);
}

// Dipakai Student Companion. Filter className bukan cuma demi efisiensi:
// rules siswa mensyaratkan workspaceId + className cocok dengan profilnya,
// dan query list baru diizinkan Firestore kalau filternya menjamin itu —
// getAllSchedules (workspaceId saja) akan ditolak untuk siswa.
export async function getSchedulesByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.SCHEDULES, [
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
