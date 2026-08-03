import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAllSchedules(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]]);
}

export async function createSchedule(workspaceId: string, data: Record<string, any>) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  return addDocument(COLLECTIONS.SCHEDULES, { ...data, workspaceId });
}

export async function deleteSchedule(id: string) {
  return deleteDocument(COLLECTIONS.SCHEDULES, id);
}
