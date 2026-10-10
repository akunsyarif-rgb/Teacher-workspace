// Proyeksi identitas modul Ulangan Harian: Firestore (kebenaran) → Supabase ulh_members / ulh_roster.
// Server-only. Ditulis dengan service_role HANYA oleh kode ini; klien tidak punya hak tulis (lihat migrasi 20261010000000).
//  - uid berasal dari ID token Firebase yang SUDAH diverifikasi pemanggil; tidak pernah dari body request.
//  - peran/workspace/kelas dibaca dari dokumen Firestore (dijaga firestore.rules), bukan dari klien.
//  - siswa: profil dicocokkan dengan dokumen students (workspace + kelas harus sama) sebelum diproyeksikan.
//  - tidak ada profil/ketidakcocokan → baris dicabut (fail-closed). TTL di sisi RPC menutup kasus sinkronisasi berhenti.
export type Doc = Record<string, unknown>;

export interface IdentitySources {
  getDoc(collection: string, id: string): Promise<Doc | null>;
  listStudents(workspaceId: string): Promise<{ id: string; className: string; name: string }[]>;
}
export interface IdentitySink {
  upsert(table: string, rows: Doc[], onConflict: string): Promise<void>;
  remove(table: string, filter: string): Promise<void>;
}

const ROLES = new Set(['OWNER', 'ADMIN', 'TEACHER']);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const CHUNK = 400;
const enc = encodeURIComponent;

export type SyncResult = { kind: 'teacher' | 'student' | null; rosterCount?: number };

export async function syncUlanganIdentity(
  opts: { uid: string; roster?: boolean; now?: () => Date },
  src: IdentitySources,
  sink: IdentitySink
): Promise<SyncResult> {
  const { uid } = opts;
  if (!uid) throw new Error('uid wajib');
  const ts = (opts.now?.() ?? new Date()).toISOString();

  const teacher = await src.getDoc('teacher_profiles', uid);
  const tWs = str(teacher?.workspaceId);
  const tRole = str(teacher?.role);
  // Pertahanan berlapis di atas firestore.rules: workspace harus ada, dan OWNER harus benar-benar pemilik (ownerUid) workspace itu.
  const tWsDoc = teacher && tWs && ROLES.has(tRole) && teacher.isActive !== false ? await src.getDoc('workspaces', tWs) : null;
  if (teacher && tWsDoc && (tRole !== 'OWNER' || str(tWsDoc.ownerUid) === uid)) {
    await sink.upsert('ulh_members', [{
      user_id: uid, kind: 'teacher', workspace_id: tWs, role: tRole, student_id: null, class_name: null,
      name: str(teacher.name) || null, synced_at: ts,
    }], 'user_id');
    if (!opts.roster) return { kind: 'teacher' };
    const students = (await src.listStudents(tWs)).filter((s) => s.id && s.className);
    for (let i = 0; i < students.length; i += CHUNK) {
      await sink.upsert('ulh_roster', students.slice(i, i + CHUNK).map((s) => ({
        workspace_id: tWs, student_id: s.id, class_name: s.className, name: s.name || null, synced_at: ts,
      })), 'workspace_id,student_id');
    }
    // Hanya setelah SEMUA upsert berhasil: buang siswa yang sudah tidak ada di Firestore.
    await sink.remove('ulh_roster', `workspace_id=eq.${enc(tWs)}&synced_at=lt.${enc(ts)}`);
    return { kind: 'teacher', rosterCount: students.length };
  }

  const prof = await src.getDoc('student_profiles', uid);
  const sId = str(prof?.studentId);
  const sWs = str(prof?.workspaceId);
  const sClass = str(prof?.className);
  if (prof && sId && sWs && sClass) {
    const student = await src.getDoc('students', sId);
    if (student && str(student.workspaceId) === sWs && str(student.className) === sClass) {
      await sink.upsert('ulh_members', [{
        user_id: uid, kind: 'student', workspace_id: sWs, role: null, student_id: sId, class_name: sClass,
        name: str(student.name) || str(prof.name) || null, synced_at: ts,
      }], 'user_id');
      return { kind: 'student' };
    }
  }

  await sink.remove('ulh_members', `user_id=eq.${enc(uid)}`);
  return { kind: null };
}
