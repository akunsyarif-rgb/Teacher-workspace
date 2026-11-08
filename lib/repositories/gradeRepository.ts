import { getDocuments, batchWrite, BatchOperation, serverTimestamp } from '../adapters/firestoreAdapter';
import type { Doc } from '../adapters/firestoreAdapter';
import type { GradeData } from '../types/models';
import { COLLECTIONS } from '../config/constants';

export async function getGradesByClass(workspaceId: string, className: string): Promise<Doc<GradeData>[]> {
  if (!workspaceId || !className) return [];
  return getDocuments<GradeData>(COLLECTIONS.GRADES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

// Dipakai Student Companion. Filter studentId wajib (bukan className):
// rules siswa hanya mengizinkan baca nilai miliknya sendiri, dan query
// list baru lolos kalau filternya menjamin hal itu.
export async function getGradesByStudent(workspaceId: string, studentId: string): Promise<Doc<GradeData>[]> {
  if (!workspaceId || !studentId) return [];
  return getDocuments<GradeData>(COLLECTIONS.GRADES, [
    ['workspaceId', '==', workspaceId],
    ['studentId', '==', studentId],
  ]);
}

export async function saveGradesBatch(
  workspaceId: string,
  className: string,
  entries: { studentId: string; columnId: string; score: string }[]
) {
  if (!workspaceId || !className) return;
  const operations: BatchOperation[] = entries.map((entry) => {
    const docId = `${entry.studentId}_${entry.columnId}`;
    if (entry.score === '') {
      return { type: 'delete', collectionName: COLLECTIONS.GRADES, id: docId };
    }
    return {
      type: 'set',
      collectionName: COLLECTIONS.GRADES,
      id: docId,
      data: {
        workspaceId,
        className,
        studentId: entry.studentId,
        columnId: entry.columnId,
        score: entry.score,
        updatedAt: serverTimestamp(),
      },
    };
  });
  return batchWrite(operations);
}
