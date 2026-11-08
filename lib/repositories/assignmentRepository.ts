import { getDocuments, getAllDocumentsPaged, addDocument, updateDocument, softDeleteDocument, restoreDocument } from '../adapters/firestoreAdapter';
import { activeOnly, deletedOnly } from '../utils/softDelete';
import type { Doc } from '../adapters/firestoreAdapter';
import type { AssignmentData } from '../types/models';
import { COLLECTIONS } from '../config/constants';

async function fetchAssignmentsByClass(workspaceId: string, className: string): Promise<Doc<AssignmentData>[]> {
  return getDocuments<AssignmentData>(COLLECTIONS.ASSIGNMENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

// Hanya tugas aktif (yang di-soft-delete tidak muncul di guru maupun siswa).
export async function getAssignmentsByClass(workspaceId: string, className: string): Promise<Doc<AssignmentData>[]> {
  if (!workspaceId || !className) return [];
  return activeOnly(await fetchAssignmentsByClass(workspaceId, className));
}

// Seluruh tugas terhapus di workspace (Sampah).
export async function getDeletedAssignments(workspaceId: string): Promise<Doc<AssignmentData>[]> {
  if (!workspaceId) return [];
  return deletedOnly(await getAllDocumentsPaged<AssignmentData>(COLLECTIONS.ASSIGNMENTS, [['workspaceId', '==', workspaceId]]));
}

export async function getDeletedAssignmentsByClass(workspaceId: string, className: string): Promise<Doc<AssignmentData>[]> {
  if (!workspaceId || !className) return [];
  return deletedOnly(await fetchAssignmentsByClass(workspaceId, className));
}

export async function createAssignment(data: Record<string, unknown>) {
  return addDocument(COLLECTIONS.ASSIGNMENTS, data);
}

export async function updateAssignment(id: string, data: Record<string, unknown>) {
  return updateDocument(COLLECTIONS.ASSIGNMENTS, id, data);
}

// Soft delete — tugas dan pengumpulan siswa tetap tersimpan, bisa dipulihkan.
export async function deleteAssignment(id: string) {
  return softDeleteDocument(COLLECTIONS.ASSIGNMENTS, id);
}

export async function restoreAssignment(id: string) {
  return restoreDocument(COLLECTIONS.ASSIGNMENTS, id);
}
