import { FieldValue } from 'firebase-admin/firestore';
import { ApiError } from './apiErrors';
import { getAdminDb } from './firebaseAdmin';
import { generateAccessCode } from '../utils/accessCode';
import { getEffectiveClassLimit } from '../config/plans';

const MAX_STUDENTS_PER_REQUEST = 200; // 2 tulis/siswa, batas transaksi Firestore 500

export class StudentAdminError extends ApiError {}

export type NewStudentInput = { name: string; nis?: string; className: string };
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

  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new StudentAdminError('Data siswa wajib diisi.', 400);
  }
  if (inputs.length > MAX_STUDENTS_PER_REQUEST) {
    throw new StudentAdminError(`Maksimal ${MAX_STUDENTS_PER_REQUEST} siswa per permintaan.`, 400);
  }

  const cleaned = inputs.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const nis = typeof r.nis === 'string' && r.nis.trim() ? r.nis.trim() : '-';
    const className = normalizeClass(r.className);
    if (!name || name.length > 120) throw new StudentAdminError('Nama siswa wajib diisi (maks 120 karakter).', 400);
    if (nis.length > 40) throw new StudentAdminError('NIS maksimal 40 karakter.', 400);
    if (!className || className.length > 100) throw new StudentAdminError('Nama kelas wajib diisi (maks 100 karakter).', 400);
    return { name, nis, className };
  });

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
      adminDb.collection('students').where('workspaceId', '==', workspaceId).select('className')
    );
    const existingClasses = new Set<string>();
    existingSnap.docs.forEach((d) => {
      const c = normalizeClass(d.get('className'));
      if (c) existingClasses.add(c);
    });

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
