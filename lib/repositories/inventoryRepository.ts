import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getItems(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return adapterFor(COLLECTIONS.CLASS_INVENTORY).getDocuments(COLLECTIONS.CLASS_INVENTORY, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createItem(data: Record<string, any>) {
  return adapterFor(COLLECTIONS.CLASS_INVENTORY).addDocument(COLLECTIONS.CLASS_INVENTORY, data);
}

export async function updateItem(id: string, data: Record<string, any>) {
  return adapterFor(COLLECTIONS.CLASS_INVENTORY).updateDocument(COLLECTIONS.CLASS_INVENTORY, id, data);
}

export async function deleteItem(id: string) {
  return adapterFor(COLLECTIONS.CLASS_INVENTORY).deleteDocument(COLLECTIONS.CLASS_INVENTORY, id);
}
