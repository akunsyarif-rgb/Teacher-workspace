import {
  getTeacherProfile,
  saveTeacherProfile,
  setTeacherWorkspace,
  updateTeacherQuickNote,
  TeacherProfile,
  TeacherRole,
} from '../repositories/teacherProfileRepository';

export async function loadTeacherProfile(uid: string) {
  return getTeacherProfile(uid);
}

export async function updateTeacherName(uid: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Nama tidak boleh kosong.');
  }
  return saveTeacherProfile(uid, { name: trimmed });
}

export async function updateTeacherSubject(uid: string, subject: string) {
  const trimmed = subject.trim();
  if (!trimmed) {
    throw new Error('Mata pelajaran tidak boleh kosong.');
  }
  return saveTeacherProfile(uid, { subject: trimmed });
}

// Fungsi baru: update quickNote
export async function updateTeacherQuickNoteService(uid: string, quickNote: string) {
  if (!uid) throw new Error('UID diperlukan.');
  return updateTeacherQuickNote(uid, quickNote);
}

export async function assignTeacherToWorkspace(
  uid: string,
  workspaceId: string,
  role: TeacherRole
) {
  return setTeacherWorkspace(uid, workspaceId, role);
}
