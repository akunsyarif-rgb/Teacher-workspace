import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/src/config/firebase';

const TEACHER_PROFILES_COLLECTION = 'teacher_profiles';

export type TeacherRole = 'OWNER' | 'ADMIN' | 'TEACHER';

export type TeacherProfile = {
  name?: string;
  subject?: string;
  workspaceId?: string;
  role?: TeacherRole;
  isActive?: boolean;
  quickNote?: string; // <-- TAMBAH
};

export async function getTeacherProfile(uid: string): Promise<TeacherProfile | null> {
  const snap = await getDoc(doc(db, TEACHER_PROFILES_COLLECTION, uid));
  return snap.exists() ? (snap.data() as TeacherProfile) : null;
}

export async function saveTeacherProfile(uid: string, data: TeacherProfile) {
  await setDoc(doc(db, TEACHER_PROFILES_COLLECTION, uid), data, { merge: true });
  return data;
}

export async function setTeacherWorkspace(
  uid: string,
  workspaceId: string,
  role: TeacherRole
) {
  return saveTeacherProfile(uid, { workspaceId, role, isActive: true });
}

// Fungsi khusus untuk update quickNote saja (lebih ringan)
export async function updateTeacherQuickNote(uid: string, quickNote: string) {
  await updateDoc(doc(db, TEACHER_PROFILES_COLLECTION, uid), { quickNote });
  return { quickNote };
}
