import { FieldValue } from 'firebase-admin/firestore';
import { ApiError, parseBody } from './apiErrors';
import { CreateStudentsBodySchema } from '../schemas/api';
import type { NewStudent } from '../schemas/api';
import { getAdminDb } from './firebaseAdmin';
import { generateAccessCode } from '../utils/accessCode';
import { getEffectiveClassLimit } from '../config/plans';


export class StudentAdminError extends ApiError {}

export type NewStudentInput = Pick<NewStudent, 'name' | 'className'> & { nis?: string };
export type CreatedStudent = { id: string; name: string; nis: string; className: string; accessCode: string };

type AdminDbLike = ReturnType<typeof getAdminDb>;

function normalizeClass(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toUpperCase() : '';
}

// Satu-satunya jalur pembuatan siswa (firestore.rules: students allow create
// = false). Di sinilah batas kelas paket dan masa berlaku paket ditegakkan,
// karena rules tidak bisa menghitung jumlah kelas distinct. workspaceId
// dibaca dari teacher_profiles milik pemanggil (token terverifikasi), TIDAK
// dari body. Pengecekan + penulisan satu transaksi supaya dua permintaan
// paralel tidak sama-sama lolos di batas.
export async function createStudentsServer(
  uid: string,
  inputs: unknown,
  db?: AdminDbLike
): Promise<CreatedStudent[]> {
  const adminDb = db ?? getAdminDb();

  // Bentuk + batas input divalidasi skema Zod (lib/schemas/api.ts); nama kelas dinormalkan (huruf besar, spasi).
  const { students: cleaned } = parseBody(CreateStudentsBodySchema, { students: inputs });

  const profileSnap = await adminDb.collection('teacher_profiles').doc(uid).get();
  const workspaceId = (profileSnap.data() as { workspaceId?: string } | undefined)?.workspaceId;
  if (!profileSnap.exists || !workspaceId) {
    throw new StudentAdminError('Akun ini bukan guru aktif di sebuah workspace.', 403);
  }

  return adminDb.runTransaction(async (tx) => {
    const workspaceSnap = await tx.get(adminDb.collection('workspaces').doc(workspaceId));
    if (!workspaceSnap.exists) throw new StudentAdminError('Workspace tidak ditemukan.', 404);
    const workspace = workspaceSnap.data() as { classLimit?: number | null; planExpiresAt?: number | null };

    const existingSnap = await tx.get(
      adminDb.collection('students').where('workspaceId', '==', workspaceId).select('className', 'deletedAt')
    );
    const existingClasses = new Set<string>();
    existingSnap.docs.forEach((d) => {
      if (d.get('deletedAt')) return; // kelas yang semua siswanya di-soft-delete tidak terhitung
      const c = normalizeClass(d.get('className'));
      if (c) existingClasses.add(c);
    });

    // Kelas yang sedang diganti namanya tidak boleh ketambahan siswa (akan terlewat oleh rename berjalan).
    const renameSnap = await tx.get(adminDb.collection('class_rename_jobs').doc(workspaceId));
    const rename = renameSnap.exists ? (renameSnap.data() as { status?: string; oldName?: string }) : null;
    if (rename?.status === 'running' && cleaned.some((s) => normalizeClass(rename.oldName) === s.className)) {
      throw new StudentAdminError('Kelas ini sedang diganti namanya. Tunggu sampai selesai lalu coba lagi.', 409);
    }

    const newClasses = new Set(cleaned.map((s) => s.className).filter((c) => !existingClasses.has(c)));
    const limit = getEffectiveClassLimit(workspace);
    if (newClasses.size > 0 && limit !== null && existingClasses.size + newClasses.size > limit) {
      throw new StudentAdminError(
        `Paket Anda dibatasi maksimal ${limit} kelas. Hubungi admin untuk upgrade atau perpanjang paket.`,
        403
      );
    }

    const created: CreatedStudent[] = [];
    for (const s of cleaned) {
      const ref = adminDb.collection('students').doc();
      const accessCode = generateAccessCode();
      // create() gagal bila dokumen sudah ada -> tabrakan kode akses tidak menimpa kode siswa lain.
      tx.create(ref, {
        ...s,
        workspaceId,
        accessCode,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.create(adminDb.collection('student_login_codes').doc(accessCode), {
        studentId: ref.id,
        workspaceId,
        name: s.name,
        className: s.className,
        nis: s.nis,
      });
      created.push({ id: ref.id, ...s, accessCode });
    }
    return created;
  });
}
