import { activeOnly } from '../utils/softDelete';
import { getDocuments, getDocumentsWhereIn } from '../adapters/firestoreAdapter';
import type { Doc } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';
import type { AssignmentData, SubmissionData } from '../types/models';

// Analitik hanya menilai jendela waktu terbatas (lib/utils/insights.ts: ANALYSIS_WINDOW_DAYS),
// jadi yang diambil juga hanya itu — BUKAN seluruh riwayat tugas dan pengumpulan sejak awal
// dipakai (yang makin besar tiap semester). Tugas dibatasi lewat rentang tenggat (indeks
// workspaceId+dueDate), pengumpulan lewat id tugas-tugas itu saja.
export async function getAssignmentsDueInRange(
  workspaceId: string,
  startDate: string,
  endDate: string
): Promise<Doc<AssignmentData>[]> {
  if (!workspaceId) return [];
  const rows = await getDocuments<AssignmentData>(COLLECTIONS.ASSIGNMENTS, [
    ['workspaceId', '==', workspaceId],
    ['dueDate', '>=', startDate],
    ['dueDate', '<=', endDate],
  ]);
  return activeOnly(rows);
}

export async function getSubmissionsForAssignments(
  workspaceId: string,
  assignmentIds: string[]
): Promise<Doc<SubmissionData>[]> {
  if (!workspaceId || assignmentIds.length === 0) return [];
  return getDocumentsWhereIn<SubmissionData>(
    COLLECTIONS.SUBMISSIONS,
    [['workspaceId', '==', workspaceId]],
    'assignmentId',
    assignmentIds
  );
}
