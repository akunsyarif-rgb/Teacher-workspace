import { getDocuments, batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getGradesByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.GRADES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
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
        updatedAt: new Date().toISOString(),
      },
    };
  });
  return batchWrite(operations);
}
