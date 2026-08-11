import * as studentNoteRepository from '../repositories/studentNoteRepository';
import { getWitaDateString } from '../utils/witaDate';

export async function loadNotes(workspaceId: string, className: string, category: string) {
  if (!workspaceId || !className || !category) return [];
  const notes = await studentNoteRepository.getNotes(workspaceId, className, category);
  return notes.sort((a: any, b: any) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function addNote(
  workspaceId: string,
  className: string,
  category: string,
  data: { studentId: string; studentName: string; title: string; notes: string }
) {
  if (!workspaceId || !className) throw new Error('Kelas tidak valid.');
  if (!data.studentId) throw new Error('Siswa wajib dipilih.');
  if (!data.title || !data.title.trim()) throw new Error('Judul/topik wajib diisi.');

  return studentNoteRepository.createNote({
    workspaceId,
    className,
    category,
    studentId: data.studentId,
    studentName: data.studentName,
    title: data.title.trim(),
    notes: data.notes?.trim() || '',
    date: getWitaDateString(),
  });
}

export async function removeNote(id: string) {
  return studentNoteRepository.deleteNote(id);
}
