import { getDocuments, addDocument, updateDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function listByWorkspace(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.ACADEMIC_YEARS, [['workspaceId', '==', workspaceId]]);
}

export async function getActive(workspaceId: string) {
  if (!workspaceId) return null;
  const docs = await getDocuments(COLLECTIONS.ACADEMIC_YEARS, [
    ['workspaceId', '==', workspaceId],
    ['isActive', '==', true],
  ]);
  return (docs[0] as any) ?? null;
}

export async function create(data: Record<string, any>) {
  return addDocument(COLLECTIONS.ACADEMIC_YEARS, data);
}

export async function update(id: string, data: Record<string, any>) {
  return updateDocument(COLLECTIONS.ACADEMIC_YEARS, id, data);
}
