import { getDocuments, batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getGradesByClass(className: string) {
  if (!className) return [];
  return getDocuments(COLLECTIONS.GRADES, [['className', '==', className]]);
}

export async function saveGradesBatch(
  className: string,
  entries: { studentId: string; columnId: string; score: string }[]
) {
  if (!className) return;
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
        className,
        studentId: entry.studentId,
        columnId: entry.columnId,
        score: entry.score,
        updatedAt: new Date().toISOString(),
      },
    };
  });
  return batchWrite(operations);
}
