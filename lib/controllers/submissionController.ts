import * as submissionService from '../services/submissionService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function submissionsCacheKey(workspaceId: string, assignmentId: string) {
  return `submissions:${workspaceId}:${assignmentId}`;
}

export async function fetchSubmissions(workspaceId: string, className: string, assignmentId: string) {
  if (!workspaceId || !className || !assignmentId) return [];
  return withCache(submissionsCacheKey(workspaceId, assignmentId), () =>
    submissionService.getSubmissionsForAssignment(workspaceId, className, assignmentId)
  );
}

export async function submitAssignment(
  workspaceId: string,
  assignmentId: string,
  studentId: string,
  className: string,
  answer: {
    textAnswer?: string;
    attachments?: { fileUrl: string; fileName: string; filePath?: string }[];
    fileUrl?: string;
    fileName?: string;
    filePath?: string;
  },
  dueDate?: string | null
) {
  const result = await submissionService.submitAssignment(
    workspaceId,
    assignmentId,
    studentId,
    className,
    answer,
    dueDate
  );
  clearAllCached();
  return result;
}

// Catatan guru disimpan lewat jalur sendiri, tanpa menyentuh nilai —
// lihat submissionService.saveSubmissionFeedback.
export async function saveFeedback(
  workspaceId: string,
  className: string,
  assignmentId: string,
  studentId: string,
  feedback: string
) {
  const result = await submissionService.saveSubmissionFeedback(
    workspaceId,
    className,
    assignmentId,
    studentId,
    feedback
  );
  clearAllCached();
  return result;
}

export async function gradeSubmission(
  workspaceId: string,
  className: string,
  assignmentId: string,
  gradeColumnId: string,
  studentId: string,
  score: string,
  feedback?: string,
  hasSubmitted?: boolean
) {
  const result = await submissionService.gradeSubmission(
    workspaceId,
    className,
    assignmentId,
    gradeColumnId,
    studentId,
    score,
    feedback,
    hasSubmitted
  );
  clearAllCached();
  return result;
}
