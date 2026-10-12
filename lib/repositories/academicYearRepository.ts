import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function listByWorkspace(workspaceId: string) {
  if (!workspaceId) return [];
  return adapterFor(COLLECTIONS.ACADEMIC_YEARS).getDocuments(COLLECTIONS.ACADEMIC_YEARS, [['workspaceId', '==', workspaceId]]);
}

export async function getActive(workspaceId: string) {
  if (!workspaceId) return null;
  const docs = await adapterFor(COLLECTIONS.ACADEMIC_YEARS).getDocuments(COLLECTIONS.ACADEMIC_YEARS, [
    ['workspaceId', '==', workspaceId],
    ['isActive', '==', true],
  ]);
  return (docs[0] as any) ?? null;
}

export async function create(data: Record<string, any>) {
  return adapterFor(COLLECTIONS.ACADEMIC_YEARS).addDocument(COLLECTIONS.ACADEMIC_YEARS, data);
}

export async function update(id: string, data: Record<string, any>) {
  return adapterFor(COLLECTIONS.ACADEMIC_YEARS).updateDocument(COLLECTIONS.ACADEMIC_YEARS, id, data);
}
