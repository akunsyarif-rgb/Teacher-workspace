import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import type { Doc } from '../adapters/firestoreAdapter';
import type { StudentNoteData } from '../types/models';
import { COLLECTIONS } from '../config/constants';

export async function getNotes(workspaceId: string, className: string, category: string): Promise<Doc<StudentNoteData>[]> {
  if (!workspaceId || !className || !category) return [];
  return getDocuments<StudentNoteData>(COLLECTIONS.STUDENT_NOTES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
    ['category', '==', category],
  ]);
}

export async function createNote(data: Record<string, unknown>) {
  return addDocument(COLLECTIONS.STUDENT_NOTES, data);
}

export async function deleteNote(id: string) {
  return deleteDocument(COLLECTIONS.STUDENT_NOTES, id);
}
