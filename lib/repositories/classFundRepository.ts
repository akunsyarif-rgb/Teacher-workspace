import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import type { Doc } from '../adapters/firestoreAdapter';
import type { ClassFundTransactionData } from '../types/models';
import { COLLECTIONS } from '../config/constants';

export async function getTransactions(workspaceId: string, className: string): Promise<Doc<ClassFundTransactionData>[]> {
  if (!workspaceId || !className) return [];
  return getDocuments<ClassFundTransactionData>(COLLECTIONS.CLASS_FUND, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createTransaction(data: Record<string, unknown>) {
  return addDocument(COLLECTIONS.CLASS_FUND, data);
}

export async function deleteTransaction(id: string) {
  return deleteDocument(COLLECTIONS.CLASS_FUND, id);
}
