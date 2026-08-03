import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS, DEFAULT_GRADE_COLUMNS } from '../config/constants';

export async function getColumnsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.GRADE_COLUMNS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createColumn(data: Record<string, any>) {
  return addDocument(COLLECTIONS.GRADE_COLUMNS, data);
}

export async function deleteColumn(id: string) {
  return deleteDocument(COLLECTIONS.GRADE_COLUMNS, id);
}

export async function createDefaultColumns(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const created = [];
  for (const col of DEFAULT_GRADE_COLUMNS) {
    const result = await createColumn({ workspaceId, className, title: col.title, type: col.type });
    created.push(result);
  }
  return created;
}
