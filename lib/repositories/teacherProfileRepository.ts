import { getDocument, setDocument, updateDocument } from '../adapters/firestoreAdapter';

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
  return getDocument(TEACHER_PROFILES_COLLECTION, uid) as Promise<TeacherProfile | null>;
}

export async function saveTeacherProfile(uid: string, data: TeacherProfile) {
  await setDocument(TEACHER_PROFILES_COLLECTION, uid, data);
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
  await updateDocument(TEACHER_PROFILES_COLLECTION, uid, { quickNote });
  return { quickNote };
}

// CATATAN: sengaja TIDAK ADA countTeachersInWorkspace di sini lagi. Count
// query client-side yang difilter workspaceId ke collection ini TIDAK BISA
// dibuat aman untuk kasus "guru baru mau join lewat kode undangan" — pada
// titik itu mereka belum py hubungan apa pun ke workspace tujuan, jadi
// tidak ada rule realistis yang bisa memberi mereka izin list/count tanpa
// membuka data anggota workspace ke siapa pun yang menebak workspaceId.
// Terbukti gagal bahkan untuk OWNER yang sudah py profil (lihat commit
// yang memindahkan seat-limit check ke app/api/workspace/join/route.ts).
// Kalau butuh hitung anggota workspace lagi nanti, lakukan lewat Admin SDK
// di server (lib/server/workspaceAdminService.ts), bukan di sini.
