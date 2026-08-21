import { getDocument, getDocuments, batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

// Satu dokumen per (assignment, siswa) — bukan satu dokumen per assignment
// berisi array semua siswa (seperti attendances). Submission nantinya akan
// ditulis langsung oleh siswa dari Student Companion, jadi tiap siswa perlu
// bisa menulis dokumennya sendiri tanpa berebut satu dokumen bersama.
function submissionId(assignmentId: string, studentId: string) {
  return `${assignmentId}_${studentId}`;
}

export async function getSubmissionsByAssignment(workspaceId: string, assignmentId: string) {
  if (!workspaceId || !assignmentId) return [];
  return getDocuments(COLLECTIONS.SUBMISSIONS, [
    ['workspaceId', '==', workspaceId],
    ['assignmentId', '==', assignmentId],
  ]);
}

/**
 * Satu dokumen submission milik seorang siswa untuk satu tugas. Dibaca
 * lewat ID (bukan query) karena ID-nya memang deterministik — inilah yang
 * membuat pengumpulan berulang selalu MENIMPA dokumen yang sama, bukan
 * membuat submission baru tiap kali tombol kirim ditekan.
 */
export async function getSubmission(assignmentId: string, studentId: string) {
  if (!assignmentId || !studentId) return null;
  return getDocument(COLLECTIONS.SUBMISSIONS, submissionId(assignmentId, studentId));
}

export async function getSubmissionsByStudent(workspaceId: string, studentId: string) {
  if (!workspaceId || !studentId) return [];
  return getDocuments(COLLECTIONS.SUBMISSIONS, [
    ['workspaceId', '==', workspaceId],
    ['studentId', '==', studentId],
  ]);
}

export async function upsertSubmission(
  assignmentId: string,
  studentId: string,
  data: Record<string, any>
) {
  const operations: BatchOperation[] = [
    {
      type: 'set',
      collectionName: COLLECTIONS.SUBMISSIONS,
      id: submissionId(assignmentId, studentId),
      data: { ...data, assignmentId, studentId, updatedAt: new Date().toISOString() },
    },
  ];
  await batchWrite(operations);
  return true;
}
