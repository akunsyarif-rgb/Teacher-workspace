import * as achievementRepository from '../repositories/achievementRepository';
import * as studentNoteRepository from '../repositories/studentNoteRepository';
import { STUDENT_NOTE_CATEGORIES } from '../config/constants';

function sortNewestFirst(items: any[]) {
  return items.sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
}

export async function listAchievements(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const achievements = await achievementRepository.getAchievementsByClass(workspaceId, className);
  return sortNewestFirst(achievements);
}

export async function listAchievementsForStudent(workspaceId: string, studentId: string) {
  if (!workspaceId || !studentId) return [];
  const achievements = await achievementRepository.getAchievementsByStudent(workspaceId, studentId);
  return sortNewestFirst(achievements);
}

export async function addAchievement(
  workspaceId: string,
  className: string,
  data: { studentId: string; studentName: string; title: string; notes: string }
) {
  if (!workspaceId || !className) throw new Error('Kelas tidak valid.');
  if (!data.studentId) throw new Error('Siswa wajib dipilih.');
  if (!data.title || !data.title.trim()) throw new Error('Nama prestasi wajib diisi.');

  return achievementRepository.createAchievement({
    workspaceId,
    className,
    studentId: data.studentId,
    studentName: data.studentName,
    title: data.title.trim(),
    notes: data.notes?.trim() || '',
    date: new Date().toISOString().split('T')[0],
  });
}

export async function removeAchievement(id: string) {
  return achievementRepository.deleteAchievement(id);
}

/**
 * Prestasi yang tercatat sebelum pemisahan koleksi masih tersimpan di
 * student_notes. Ini menyalinnya ke student_achievements supaya tetap
 * terlihat guru DAN mulai bisa dilihat siswa. Aman dijalankan berulang.
 */
export async function countUnmigratedAchievements(workspaceId: string, className: string) {
  const [legacyNotes, achievements] = await Promise.all([
    studentNoteRepository.getNotes(workspaceId, className, STUDENT_NOTE_CATEGORIES.PRESTASI),
    achievementRepository.getAchievementsByClass(workspaceId, className),
  ]);
  const existingIds = new Set(achievements.map((item: any) => item.id));
  return legacyNotes.filter((note: any) => !existingIds.has(note.id)).length;
}

export async function migrateLegacyAchievements(workspaceId: string, className: string) {
  if (!workspaceId || !className) throw new Error('Kelas tidak valid.');
  const [legacyNotes, achievements] = await Promise.all([
    studentNoteRepository.getNotes(workspaceId, className, STUDENT_NOTE_CATEGORIES.PRESTASI),
    achievementRepository.getAchievementsByClass(workspaceId, className),
  ]);
  const existingIds = new Set(achievements.map((item: any) => item.id));
  const pending = legacyNotes.filter((note: any) => !existingIds.has(note.id));
  return achievementRepository.copyFromNotes(pending as any);
}
