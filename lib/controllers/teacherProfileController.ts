import { loadTeacherProfile, updateTeacherName, updateTeacherSubject, updateTeacherQuickNoteService } from '../services/teacherProfileService';

export async function fetchTeacherProfile(uid: string) {
  return loadTeacherProfile(uid);
}

export async function saveTeacherName(uid: string, name: string) {
  return updateTeacherName(uid, name);
}

export async function saveTeacherSubject(uid: string, subject: string) {
  return updateTeacherSubject(uid, subject);
}

// Fungsi baru: update quickNote
export async function saveTeacherQuickNote(uid: string, quickNote: string) {
  return updateTeacherQuickNoteService(uid, quickNote);
}
