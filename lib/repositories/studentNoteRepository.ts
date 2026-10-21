import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getNotes(workspaceId: string, className: string, category: string) {
  if (!workspaceId || !className || !category) return [];
  return adapterFor(COLLECTIONS.STUDENT_NOTES).getDocuments(COLLECTIONS.STUDENT_NOTES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
    ['category', '==', category],
  ]);
}

export async function createNote(data: Record<string, any>) {
  return adapterFor(COLLECTIONS.STUDENT_NOTES).addDocument(COLLECTIONS.STUDENT_NOTES, data);
}

export async function deleteNote(id: string) {
  return adapterFor(COLLECTIONS.STUDENT_NOTES).deleteDocument(COLLECTIONS.STUDENT_NOTES, id);
}
