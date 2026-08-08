import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAssignmentsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.ASSIGNMENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createAssignment(data: Record<string, any>) {
  return addDocument(COLLECTIONS.ASSIGNMENTS, data);
}

export async function deleteAssignment(id: string) {
  return deleteDocument(COLLECTIONS.ASSIGNMENTS, id);
}
