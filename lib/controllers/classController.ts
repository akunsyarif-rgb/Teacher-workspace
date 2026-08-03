import * as studentService from '../services/studentService';

export async function fetchClassSummaries(workspaceId: string) {
  if (!workspaceId) return [];
  return studentService.listClassSummaries(workspaceId);
}

export async function fetchStudentsInClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return studentService.getStudentsInClass(workspaceId, className);
}

export async function submitSingleStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  return studentService.addSingleStudent(workspaceId, data);
}

export async function submitBulkStudents(
  workspaceId: string,
  className: string,
  namesText: string
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  return studentService.addBulkStudents(workspaceId, className, namesText);
}

export async function deleteStudent(id: string) {
  return studentService.removeStudent(id);
}
