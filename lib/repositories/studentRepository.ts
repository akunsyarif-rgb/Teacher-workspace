import { getDocuments, getDocument, deleteDocument, batchWrite, generateId, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';
import { generateAccessCode } from '../utils/accessCode';

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

export async function getStudentById(id: string) {
  if (!id) return null;
  return getDocument(COLLECTIONS.STUDENTS, id);
}

// Setiap siswa dapat accessCode unik untuk login ke Student Companion —
// disimpan juga sebagai dokumen terpisah di student_login_codes (id
// dokumen = kode itu sendiri) supaya alur klaim akun bisa mencari
// berdasarkan kode tanpa perlu query koleksi students yang lebih sensitif.
export async function createStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const id = generateId(COLLECTIONS.STUDENTS);
  const accessCode = generateAccessCode();
  const operations: BatchOperation[] = [
    {
      type: 'set',
      collectionName: COLLECTIONS.STUDENTS,
      id,
      data: { ...data, workspaceId, accessCode, createdAt: new Date().toISOString() },
    },
    {
      type: 'set',
      collectionName: COLLECTIONS.STUDENT_LOGIN_CODES,
      id: accessCode,
      data: { studentId: id, workspaceId },
    },
  ];
  await batchWrite(operations);
  return { id, ...data, workspaceId, accessCode };
}

export async function createStudentsBatch(
  workspaceId: string,
  students: { name: string; nis: string; className: string }[]
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const operations: BatchOperation[] = [];
  students.forEach((student) => {
    const id = generateId(COLLECTIONS.STUDENTS);
    const accessCode = generateAccessCode();
    operations.push({
      type: 'set',
      collectionName: COLLECTIONS.STUDENTS,
      id,
      data: { ...student, workspaceId, accessCode, createdAt: new Date().toISOString() },
    });
    operations.push({
      type: 'set',
      collectionName: COLLECTIONS.STUDENT_LOGIN_CODES,
      id: accessCode,
      data: { studentId: id, workspaceId },
    });
  });

  await batchWrite(operations);
  return students.length;
}

export async function deleteStudent(id: string) {
  return deleteDocument(COLLECTIONS.STUDENTS, id);
}
