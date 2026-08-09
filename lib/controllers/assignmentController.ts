import * as assignmentService from '../services/assignmentService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function assignmentsCacheKey(workspaceId: string, className: string) {
  return `assignments:${workspaceId}:${className}`;
}

export async function fetchAssignments(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(assignmentsCacheKey(workspaceId, className), () =>
    assignmentService.listAssignments(workspaceId, className)
  );
}

export async function createAssignment(
  workspaceId: string,
  className: string,
  subject: string,
  data: { title: string; description?: string; dueDate: string }
) {
  const result = await assignmentService.createAssignment(workspaceId, className, subject, data);
  clearAllCached();
  return result;
}

export async function removeAssignment(id: string) {
  const result = await assignmentService.removeAssignment(id);
  clearAllCached();
  return result;
}
