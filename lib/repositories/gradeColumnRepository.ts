import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS, DEFAULT_GRADE_COLUMNS } from '../config/constants';

export async function getColumnsByClass(className: string) {
  if (!className) return [];
  return getDocuments(COLLECTIONS.GRADE_COLUMNS, [['className', '==', className]]);
}

export async function createColumn(data: Record<string, any>) {
  return addDocument(COLLECTIONS.GRADE_COLUMNS, data);
}

export async function deleteColumn(id: string) {
  return deleteDocument(COLLECTIONS.GRADE_COLUMNS, id);
}

export async function createDefaultColumns(className: string) {
  if (!className) return [];
  const created = [];
  for (const col of DEFAULT_GRADE_COLUMNS) {
    const result = await createColumn({ className, title: col.title, type: col.type });
    created.push(result);
  }
  return created;
}
