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
  answer: { textAnswer?: string; fileUrl?: string; fileName?: string }
) {
  const result = await submissionService.submitAssignment(workspaceId, assignmentId, studentId, className, answer);
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
  feedback?: string
) {
  const result = await submissionService.gradeSubmission(
    workspaceId,
    className,
    assignmentId,
    gradeColumnId,
    studentId,
    score,
    feedback
  );
  clearAllCached();
  return result;
}
