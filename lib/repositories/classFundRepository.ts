import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getTransactions(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return adapterFor(COLLECTIONS.CLASS_FUND).getDocuments(COLLECTIONS.CLASS_FUND, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createTransaction(data: Record<string, any>) {
  return adapterFor(COLLECTIONS.CLASS_FUND).addDocument(COLLECTIONS.CLASS_FUND, data);
}

export async function deleteTransaction(id: string) {
  return adapterFor(COLLECTIONS.CLASS_FUND).deleteDocument(COLLECTIONS.CLASS_FUND, id);
}
