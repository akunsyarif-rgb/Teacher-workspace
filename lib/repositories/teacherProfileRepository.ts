import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/src/config/firebase';
import { countDocuments } from '../adapters/firestoreAdapter';

const TEACHER_PROFILES_COLLECTION = 'teacher_profiles';

export type TeacherRole = 'OWNER' | 'ADMIN' | 'TEACHER';

export type TeacherProfile = {
  name?: string;
  subject?: string;
  workspaceId?: string;
  role?: TeacherRole;
  isActive?: boolean;
  quickNote?: string; // <-- TAMBAH
  homeroomClassName?: string | null; // kelas yang diwalikan guru ini, null = bukan wali kelas
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

// Dipakai untuk menegakkan seatLimit (kuota kursi guru) paket school_annual
// sebelum guru baru diizinkan gabung lewat kode undangan.
export async function countTeachersInWorkspace(workspaceId: string) {
  if (!workspaceId) return 0;
  return countDocuments(TEACHER_PROFILES_COLLECTION, [['workspaceId', '==', workspaceId]]);
}
