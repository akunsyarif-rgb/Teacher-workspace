import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getJournalsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.JOURNALS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createJournal(data: Record<string, any>) {
  return addDocument(COLLECTIONS.JOURNALS, data);
}

export async function deleteJournal(id: string) {
  return deleteDocument(COLLECTIONS.JOURNALS, id);
}
