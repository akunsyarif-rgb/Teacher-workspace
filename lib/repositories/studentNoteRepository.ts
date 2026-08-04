import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getNotes(workspaceId: string, className: string, category: string) {
  if (!workspaceId || !className || !category) return [];
  return getDocuments(COLLECTIONS.STUDENT_NOTES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
    ['category', '==', category],
  ]);
}

export async function createNote(data: Record<string, any>) {
  return addDocument(COLLECTIONS.STUDENT_NOTES, data);
}

export async function deleteNote(id: string) {
  return deleteDocument(COLLECTIONS.STUDENT_NOTES, id);
}
