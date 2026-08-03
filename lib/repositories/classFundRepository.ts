import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getTransactions(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.CLASS_FUND, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createTransaction(data: Record<string, any>) {
  return addDocument(COLLECTIONS.CLASS_FUND, data);
}

export async function deleteTransaction(id: string) {
  return deleteDocument(COLLECTIONS.CLASS_FUND, id);
}
