import * as studentNoteService from '../services/studentNoteService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export async function fetchStudentNotes(workspaceId: string, className: string, category: string) {
  if (!workspaceId || !className || !category) return [];
  return withCache(`studentNotes:${workspaceId}:${className}:${category}`, () =>
    studentNoteService.loadNotes(workspaceId, className, category)
  );
}

export async function submitStudentNote(
  workspaceId: string,
  className: string,
  category: string,
  data: { studentId: string; studentName: string; title: string; notes: string }
) {
  const result = await studentNoteService.addNote(workspaceId, className, category, data);
  clearAllCached();
  return result;
}

export async function deleteStudentNote(id: string) {
  const result = await studentNoteService.removeNote(id);
  clearAllCached();
  return result;
}
