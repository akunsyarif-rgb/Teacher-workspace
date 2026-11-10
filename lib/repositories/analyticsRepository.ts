import { activeOnly } from '../utils/softDelete';
import { getDocuments, getDocumentsWhereIn, countDocuments } from '../adapters/firestoreAdapter';
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

// Jumlah pengumpulan per tugas lewat aggregation (1 baca per 1000 entri) — Analitik hanya butuh angkanya,
// bukan isi ribuan dokumen. Jumlahnya sama dengan menghitung dokumen dari getSubmissionsForAssignments.
export async function getSubmissionCountsForAssignments(
  workspaceId: string,
  assignmentIds: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (!workspaceId) return counts;
  const CONCURRENCY = 10;
  for (let i = 0; i < assignmentIds.length; i += CONCURRENCY) {
    const chunk = assignmentIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((id) =>
        countDocuments(COLLECTIONS.SUBMISSIONS, [['workspaceId', '==', workspaceId], ['assignmentId', '==', id]])
      )
    );
    chunk.forEach((id, k) => {
      if (results[k] > 0) counts[id] = results[k];
    });
  }
  return counts;
}
