import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAssignmentsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return adapterFor(COLLECTIONS.ASSIGNMENTS).getDocuments(COLLECTIONS.ASSIGNMENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createAssignment(data: Record<string, any>) {
  return adapterFor(COLLECTIONS.ASSIGNMENTS).addDocument(COLLECTIONS.ASSIGNMENTS, data);
}

export async function updateAssignment(id: string, data: Record<string, any>) {
  return adapterFor(COLLECTIONS.ASSIGNMENTS).updateDocument(COLLECTIONS.ASSIGNMENTS, id, data);
}

export async function deleteAssignment(id: string) {
  return adapterFor(COLLECTIONS.ASSIGNMENTS).deleteDocument(COLLECTIONS.ASSIGNMENTS, id);
}
