import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAttendanceByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.ATTENDANCES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createAttendance(data: Record<string, any>) {
  return addDocument(COLLECTIONS.ATTENDANCES, data);
}

export async function deleteAttendance(id: string) {
  return deleteDocument(COLLECTIONS.ATTENDANCES, id);
}
