import { getDocuments, addDocument, updateDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getItems(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.CLASS_INVENTORY, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createItem(data: Record<string, any>) {
  return addDocument(COLLECTIONS.CLASS_INVENTORY, data);
}

export async function updateItem(id: string, data: Record<string, any>) {
  return updateDocument(COLLECTIONS.CLASS_INVENTORY, id, data);
}

export async function deleteItem(id: string) {
  return deleteDocument(COLLECTIONS.CLASS_INVENTORY, id);
}
