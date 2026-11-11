import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';
import { ApiError } from './apiErrors';
import { normalizeClassName } from '../utils/classNameValidation';
import { getEffectiveClassLimit } from '../config/plans';
import { activeOnly, isDeleted } from '../utils/softDelete';

// Hapus / pulihkan SATU KELAS PENUH (soft delete: semua siswa kelas itu ditandai
// deletedAt, tidak ada dokumen yang benar-benar hilang). Khusus OWNER/ADMIN —
// operasi ini menyentuh data guru lain, jadi tidak diserahkan ke rules per-dokumen.
// Kelas sendiri bukan dokumen (diturunkan dari siswa), jadi "kelas terhapus" =
// semua siswanya terhapus; kelas yang kosong otomatis tidak lagi terhitung/tampil.
const BATCH_SIZE = 450;

type AdminDbLike = ReturnType<typeof getAdminDb>;

async function requireClassAdmin(db: AdminDbLike, uid: string) {
  const snap = await db.collection('teacher_profiles').doc(uid).get();
  const profile = snap.data() as { workspaceId?: string; role?: string } | undefined;
  if (!snap.exists || !profile?.workspaceId) {
    throw new ApiError('Akun ini belum terhubung ke workspace mana pun.', 403);
  }
  if (profile.role !== 'OWNER' && profile.role !== 'ADMIN') {
    throw new ApiError('Hanya pemilik atau admin workspace yang boleh menghapus atau memulihkan kelas.', 403);
  }
  return profile.workspaceId;
}

function requireClassName(input: unknown): string {
  const name = typeof input === 'string' ? normalizeClassName(input) : '';
  if (!name) throw new ApiError('Kelas tidak valid.', 400);
  return name;
}

async function studentsOfClass(db: AdminDbLike, workspaceId: string, className: string) {
  const snap = await db
    .collection('students')
    .where('workspaceId', '==', workspaceId)
    .where('className', '==', className)
    .get();
  return snap.docs;
}

async function commitInChunks(
  db: AdminDbLike,
  refs: FirebaseFirestore.DocumentReference[],
  patch: Record<string, unknown>
) {
  // Tiap chunk atomik (<= 450 < batas 500). Operasi idempoten: aman diulang bila terputus.
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    refs.slice(i, i + BATCH_SIZE).forEach((ref) => batch.update(ref, patch));
    await batch.commit();
  }
}

// Memulihkan siswa/kelas bisa MENGHIDUPKAN kembali sebuah kelas, jadi harus lolos batas paket
// lagi (kelas yang sudah aktif tidak dihitung dua kali). Tanpa ini batas kelas bisa dilewati:
// hapus satu-satunya siswa di kelas D, buat kelas baru, lalu pulihkan siswa itu.
async function assertClassCanBecomeActive(db: AdminDbLike, workspaceId: string, className: string) {
  const wsSnap = await db.collection('workspaces').doc(workspaceId).get();
  const workspace = (wsSnap.data() ?? {}) as { classLimit?: number | null; planExpiresAt?: number | null };
  const limit = getEffectiveClassLimit(workspace);
  if (limit === null) return;
  const all = await db.collection('students').where('workspaceId', '==', workspaceId).get();
  const activeClasses = new Set(
    activeOnly(all.docs.map((d) => d.data())).map((s) => normalizeClassName(String(s.className ?? '')).toUpperCase()).filter(Boolean)
  );
  if (!activeClasses.has(className.toUpperCase()) && activeClasses.size >= limit) {
    throw new ApiError(`Paket Anda dibatasi maksimal ${limit} kelas. Upgrade atau perpanjang paket untuk memulihkan ini.`, 403);
  }
}

export async function deleteClassServer(uid: string, classNameInput: unknown, db?: AdminDbLike) {
  const adminDb = db ?? getAdminDb();
  const workspaceId = await requireClassAdmin(adminDb, uid);
  const className = requireClassName(classNameInput);

  const docs = (await studentsOfClass(adminDb, workspaceId, className)).filter((d) => !isDeleted(d.data()));
  if (docs.length === 0) throw new ApiError(`Kelas "${className}" tidak ditemukan.`, 404);

  const batchId = randomUUID();
  await commitInChunks(
    adminDb,
    docs.map((d) => d.ref),
    { deletedAt: FieldValue.serverTimestamp(), deletedBy: uid, deletedBatchId: batchId }
  );
  return { deletedCount: docs.length, className, batchId };
}

export async function restoreClassServer(uid: string, classNameInput: unknown, db?: AdminDbLike) {
  const adminDb = db ?? getAdminDb();
  const workspaceId = await requireClassAdmin(adminDb, uid);
  const className = requireClassName(classNameInput);

  const docs = await studentsOfClass(adminDb, workspaceId, className);
  // Hanya siswa yang terhapus lewat "hapus kelas" (punya deletedBatchId); siswa yang
  // dihapus satu per satu dipulihkan satu per satu.
  const toRestore = docs.filter((d) => {
    const data = d.data();
    return isDeleted(data) && !!data.deletedBatchId;
  });
  if (toRestore.length === 0) throw new ApiError(`Tidak ada kelas "${className}" yang bisa dipulihkan.`, 404);

  await assertClassCanBecomeActive(adminDb, workspaceId, className);

  await commitInChunks(
    adminDb,
    toRestore.map((d) => d.ref),
    { deletedAt: null, deletedBy: null, deletedBatchId: null }
  );
  return { restoredCount: toRestore.length, className };
}

// Pulihkan SATU siswa (yang dihapus satu per satu). Lewat server — bukan update client — karena
// pemulihan bisa menghidupkan kembali kelas dan harus menghormati batas paket. Izin dicek di sini
// (Admin SDK melewati rules): OWNER/ADMIN, atau guru yang menambahkan siswa itu (createdBy).
// Siswa yang terhapus bersama kelasnya (deletedBatchId) dipulihkan lewat kelasnya.
export async function restoreStudentServer(uid: string, studentIdInput: unknown, db?: AdminDbLike) {
  const adminDb = db ?? getAdminDb();
  const studentId = typeof studentIdInput === 'string' ? studentIdInput.trim() : '';
  if (!studentId) throw new ApiError('Siswa tidak valid.', 400);

  const profileSnap = await adminDb.collection('teacher_profiles').doc(uid).get();
  const profile = profileSnap.data() as { workspaceId?: string; role?: string } | undefined;
  if (!profileSnap.exists || !profile?.workspaceId) {
    throw new ApiError('Akun ini belum terhubung ke workspace mana pun.', 403);
  }

  const ref = adminDb.collection('students').doc(studentId);
  const snap = await ref.get();
  const student = snap.data() as { workspaceId?: string; className?: string; createdBy?: string; deletedAt?: unknown; deletedBatchId?: string | null } | undefined;
  // Siswa milik workspace lain diperlakukan sama seperti tidak ada (tidak membocorkan keberadaannya).
  if (!snap.exists || student?.workspaceId !== profile.workspaceId || !isDeleted(student)) {
    throw new ApiError('Siswa tidak ditemukan di Sampah.', 404);
  }

  const isAdmin = profile.role === 'OWNER' || profile.role === 'ADMIN';
  if (!isAdmin && student?.createdBy !== uid) {
    throw new ApiError('Anda hanya bisa memulihkan siswa yang Anda tambahkan sendiri.', 403);
  }
  if (student?.deletedBatchId) {
    throw new ApiError('Siswa ini terhapus bersama kelasnya. Pulihkan lewat kelasnya.', 409);
  }

  await assertClassCanBecomeActive(adminDb, profile.workspaceId, normalizeClassName(String(student?.className ?? '')));
  await ref.update({ deletedAt: null, deletedBy: null, deletedBatchId: null });
  return { restoredId: studentId, className: student?.className ?? '' };
}
