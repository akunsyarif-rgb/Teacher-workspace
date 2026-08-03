import { getDocuments, addDocument, deleteDocument, batchWrite, generateId, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAllStudents(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.STUDENTS, [['workspaceId', '==', workspaceId]]);
}

export async function getStudentsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const students = await getDocuments(COLLECTIONS.STUDENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
  return students.sort((a: any, b: any) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
}

export async function createStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  return addDocument(COLLECTIONS.STUDENTS, { ...data, workspaceId });
}

export async function createStudentsBatch(
  workspaceId: string,
  students: { name: string; nis: string; className: string }[]
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const operations: BatchOperation[] = students.map((student) => {
    const id = generateId(COLLECTIONS.STUDENTS);
    return {
      type: 'set',
      collectionName: COLLECTIONS.STUDENTS,
      id,
      data: { ...student, workspaceId, createdAt: new Date().toISOString() },
    };
  });

  await batchWrite(operations);
  return operations.length;
}

export async function deleteStudent(id: string) {
  return deleteDocument(COLLECTIONS.STUDENTS, id);
}
