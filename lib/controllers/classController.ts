import * as studentService from '../services/studentService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function classSummariesCacheKey(workspaceId: string) {
  return `classSummaries:${workspaceId}`;
}

export async function fetchClassSummaries(workspaceId: string) {
  if (!workspaceId) return [];
  return withCache(classSummariesCacheKey(workspaceId), () => studentService.listClassSummaries(workspaceId));
}

export function studentsInClassCacheKey(workspaceId: string, className: string) {
  return `studentsInClass:${workspaceId}:${className}`;
}

export async function fetchStudentsInClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(studentsInClassCacheKey(workspaceId, className), () =>
    studentService.getStudentsInClass(workspaceId, className)
  );
}

export async function submitSingleStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const result = await studentService.addSingleStudent(workspaceId, data);
  clearAllCached();
  return result;
}

export async function submitBulkStudents(
  workspaceId: string,
  className: string,
  namesText: string
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const result = await studentService.addBulkStudents(workspaceId, className, namesText);
  clearAllCached();
  return result;
}

export async function deleteStudent(id: string) {
  const result = await studentService.removeStudent(id);
  clearAllCached();
  return result;
}

export async function deleteClass(workspaceId: string, className: string) {
  const result = await studentService.removeClass(workspaceId, className);
  clearAllCached();
  return result;
}

export async function generateMissingAccessCodes(workspaceId: string, className: string) {
  const result = await studentService.generateMissingAccessCodes(workspaceId, className);
  clearAllCached();
  return result;
}
