// Identitas guru/siswa untuk Ulangan Harian — dibaca dari FIRESTORE (sumber kebenaran Teacher Workspace) pada setiap permintaan
// yang membutuhkan identitas. Tidak ada salinan identitas di Supabase. uid hanya dari ID token Firebase yang diverifikasi
// pemanggil (route); isi body request tidak pernah menentukan workspace/peran/kelas.
export type Doc = Record<string, unknown>;

export interface IdentitySources {
  getDoc(collection: string, id: string): Promise<Doc | null>;
  /** Apakah ada siswa di workspace pada kelas ini (validasi kelas saat guru menugaskan ulangan). */
  classExists(workspaceId: string, className: string): Promise<boolean>;
  /** Siswa pada kelas-kelas ini (untuk daftar peserta di rekap). */
  listStudents(workspaceId: string, classNames: string[]): Promise<{ id: string; className: string; name: string }[]>;
}

export class AuthError extends Error {
  constructor(public code: 'not_a_teacher' | 'not_a_student', public status = 403) {
    super(code);
    this.name = 'AuthError';
  }
}

const ROLES = new Set(['OWNER', 'ADMIN', 'TEACHER']);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export type TeacherActor = { uid: string; ws: string; admin: boolean };
export type StudentActor = { uid: string; ws: string; studentId: string; className: string };

export async function resolveTeacher(uid: string, src: IdentitySources): Promise<TeacherActor> {
  const p = await src.getDoc('teacher_profiles', uid);
  const ws = str(p?.workspaceId);
  const role = str(p?.role);
  if (!p || !ws || !ROLES.has(role) || p.isActive === false) throw new AuthError('not_a_teacher');
  // Pertahanan berlapis di atas firestore.rules: workspace harus ada, dan OWNER harus benar-benar ownerUid-nya.
  const w = await src.getDoc('workspaces', ws);
  if (!w || (role === 'OWNER' && str(w.ownerUid) !== uid)) throw new AuthError('not_a_teacher');
  return { uid, ws, admin: role === 'OWNER' || role === 'ADMIN' };
}

export async function resolveStudent(uid: string, src: IdentitySources): Promise<StudentActor> {
  const prof = await src.getDoc('student_profiles', uid); // tautan uid → siswa (hasil klaim kode akses)
  const studentId = str(prof?.studentId);
  const ws = str(prof?.workspaceId);
  if (!prof || !studentId || !ws) throw new AuthError('not_a_student');
  // Kelas dari dokumen students (dikelola guru), bukan salinan profil yang bisa basi; workspace harus sama.
  const s = await src.getDoc('students', studentId);
  const className = str(s?.className);
  if (!s || !className || str(s.workspaceId) !== ws) throw new AuthError('not_a_student');
  return { uid, ws, studentId, className };
}
