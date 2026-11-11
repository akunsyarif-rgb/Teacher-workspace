import type { Firestore, QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';
import { ApiError } from './apiErrors';
import { defaultFileCleanup, type FileCleanupDeps } from './storageCleanup';
import { refsFrom } from './backup/exportWorkspace';
import { logger } from '../utils/logger';
import { isDeleted } from '../utils/softDelete';
import { normalizeClassName } from '../utils/classNameValidation';

// Hapus PERMANEN item di Sampah (khusus OWNER/ADMIN), lewat Admin SDK.
//
// Jaminan:
//  - Hanya item yang SUDAH di Sampah (deletedAt terisi) yang bisa dihapus permanen; data aktif tidak pernah tersentuh.
//  - Tiap commit adalah batch Firestore (maks 450 dokumen, < batas 500) dan ATOMIK per batch.
//  - Urutan aman-diulang: data TURUNAN dihapus lebih dulu, dokumen INDUK terakhir. Bila terputus di tengah, induknya
//    masih ada di Sampah dan penghapusan bisa diulang sampai tuntas (idempoten; query selalu mencari sisa yang ada).
//    Kebalikannya (induk dulu) akan meninggalkan anak yatim yang tak lagi terlihat dari Sampah.
//  - Lampiran fisik dihapus SEBELUM dokumen yang menyimpan path-nya; bila penyimpanan gagal, bagian itu dibatalkan.
//  - Anggaran waktu: bila habis, berhenti rapi di batas batch dan melapor done:false; panggil lagi untuk melanjutkan.
//
// Cakupan penghapusan per jenis:
//  siswa      → kode akses, sesi login (student_profiles), nilai, pengumpulan tugas + lampirannya, prestasi, catatan wali kelas
//  tugas      → seluruh pengumpulan siswa + lampirannya, materi tugas (best effort). Kolom nilai terkait TIDAK ikut (item terpisah).
//  kolom nilai→ seluruh nilai di kolom itu
//  kelas      → semua siswa yang terhapus bersama kelas itu beserta data mereka. Jurnal, presensi, jadwal kelas TIDAK ikut.
// Tidak tercakup: nama siswa yang tersalin di rekap presensi per pertemuan (details), dan data ujian Ulangan (Supabase).
const BATCH = 450;
const IN_LIMIT = 30;
const DEFAULT_BUDGET_MS = 40_000;

export type PurgeKind = 'student' | 'assignment' | 'column' | 'class';
export type PurgeTarget = { kind: PurgeKind; id: string };

export type PurgeCounts = {
  students: number;
  assignments: number;
  columns: number;
  grades: number;
  submissions: number;
  achievements: number;
  notes: number;
  profiles: number;
  loginCodes: number;
  files: number;
};

export type PurgeResult = { done: boolean; counts: PurgeCounts };

export type PurgeOptions = {
  now?: () => number;
  timeBudgetMs?: number;
  files?: FileCleanupDeps;
};

type Ctx = {
  db: Firestore;
  ws: string;
  counts: PurgeCounts;
  files: FileCleanupDeps;
  overBudget: () => boolean;
};

const emptyCounts = (): PurgeCounts => ({
  students: 0, assignments: 0, columns: 0, grades: 0, submissions: 0, achievements: 0, notes: 0, profiles: 0, loginCodes: 0, files: 0,
});

type Filter = [string, FirebaseFirestore.WhereFilterOp, unknown];

async function requireWorkspaceAdmin(db: Firestore, uid: string): Promise<string> {
  const snap = await db.collection('teacher_profiles').doc(uid).get();
  const profile = snap.data() as { workspaceId?: string; role?: string } | undefined;
  if (!snap.exists || !profile?.workspaceId) throw new ApiError('Akun ini belum terhubung ke workspace mana pun.', 403);
  if (profile.role !== 'OWNER' && profile.role !== 'ADMIN') {
    throw new ApiError('Hanya pemilik atau admin workspace yang boleh menghapus permanen.', 403);
  }
  return profile.workspaceId;
}

/** Hapus semua dokumen yang cocok, per batch atomik. onDocs dipanggil SEBELUM batch dihapus (mis. untuk berkas). */
async function deleteWhere(
  ctx: Ctx,
  collection: string,
  filters: Filter[],
  onDocs?: (docs: QueryDocumentSnapshot<DocumentData>[]) => Promise<void>
): Promise<number> {
  let total = 0;
  for (;;) {
    let q: FirebaseFirestore.Query = ctx.db.collection(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    const snap = await q.limit(BATCH).get();
    if (snap.empty) return total;
    if (onDocs) await onDocs(snap.docs);
    const batch = ctx.db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.docs.length;
  }
}

/** Hapus lampiran fisik pengumpulan yang ada di docs (hanya path milik workspace ini, tervalidasi). */
async function purgeSubmissionFilesOf(ctx: Ctx, docs: QueryDocumentSnapshot<DocumentData>[]) {
  const paths: string[] = [];
  for (const d of docs) {
    for (const ref of refsFrom('submissions', d.id, d.data(), ctx.ws)) {
      if (ref.source === 'supabase_storage' && ref.validPath && ref.path) paths.push(ref.path);
    }
  }
  if (paths.length) ctx.counts.files += await ctx.files.deleteSubmissionFiles(paths);
}

const chunks = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Siswa (yang SUDAH di Sampah): anak dulu, dokumen siswa terakhir. Berhenti rapi bila anggaran waktu habis. */
async function purgeStudents(ctx: Ctx, students: QueryDocumentSnapshot<DocumentData>[]): Promise<boolean> {
  for (const group of chunks(students, IN_LIMIT)) {
    if (ctx.overBudget()) return false;
    const ids = group.map((s) => s.id);
    const inIds: Filter = ['studentId', 'in', ids];
    const ws: Filter = ['workspaceId', '==', ctx.ws];

    ctx.counts.grades += await deleteWhere(ctx, 'grades', [ws, inIds]);
    ctx.counts.submissions += await deleteWhere(ctx, 'submissions', [ws, inIds], (docs) => purgeSubmissionFilesOf(ctx, docs));
    ctx.counts.achievements += await deleteWhere(ctx, 'student_achievements', [ws, inIds]);
    ctx.counts.notes += await deleteWhere(ctx, 'student_notes', [ws, inIds]);
    // Sesi login siswa: tanpa ini perangkat yang sudah masuk tetap bisa membaca data kelasnya.
    ctx.counts.profiles += await deleteWhere(ctx, 'student_profiles', [ws, inIds]);
    ctx.counts.loginCodes += await deleteWhere(ctx, 'student_login_codes', [ws, inIds]);

    // Induk terakhir. Kode akses yang tersimpan di dokumen siswa ikut dibersihkan (id dokumen = kodenya).
    const batch = ctx.db.batch();
    for (const s of group) {
      const code = s.get('accessCode');
      if (typeof code === 'string' && code) batch.delete(ctx.db.collection('student_login_codes').doc(code));
      batch.delete(s.ref);
    }
    await batch.commit();
    ctx.counts.students += group.length;
  }
  return true;
}

async function purgeAssignment(ctx: Ctx, snap: QueryDocumentSnapshot<DocumentData>) {
  await deleteWhere(ctx, 'submissions', [['workspaceId', '==', ctx.ws], ['assignmentId', '==', snap.id]], async (docs) => {
    ctx.counts.submissions += docs.length;
    await purgeSubmissionFilesOf(ctx, docs);
  });
  const material = snap.get('materialFilePath');
  if (typeof material === 'string' && material.startsWith(`assignment-materials/${ctx.ws}/`)) {
    if (await ctx.files.deleteMaterialFile(material)) ctx.counts.files += 1;
  }
  await snap.ref.delete();
  ctx.counts.assignments += 1;
}

async function purgeColumn(ctx: Ctx, snap: QueryDocumentSnapshot<DocumentData>) {
  ctx.counts.grades += await deleteWhere(ctx, 'grades', [['workspaceId', '==', ctx.ws], ['columnId', '==', snap.id]]);
  await snap.ref.delete();
  ctx.counts.columns += 1;
}

async function verifiedInTrash(db: Firestore, ws: string, collection: string, id: string): Promise<QueryDocumentSnapshot<DocumentData>> {
  const snap = await db.collection(collection).doc(id).get();
  // Milik workspace lain diperlakukan sama seperti tidak ada (tidak membocorkan keberadaannya).
  if (!snap.exists || snap.get('workspaceId') !== ws) throw new ApiError('Item tidak ditemukan di Sampah.', 404);
  if (!isDeleted(snap.data())) throw new ApiError('Hanya item yang ada di Sampah yang bisa dihapus permanen.', 409);
  return snap as QueryDocumentSnapshot<DocumentData>;
}

async function deletedStudentsOf(ctx: Ctx, className?: string): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  let q: FirebaseFirestore.Query = ctx.db.collection('students').where('workspaceId', '==', ctx.ws);
  if (className) q = q.where('className', '==', className);
  const snap = await q.get();
  return snap.docs.filter((d) => isDeleted(d.data()));
}

function makeCtx(db: Firestore, ws: string, options: PurgeOptions): Ctx {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeBudgetMs ?? DEFAULT_BUDGET_MS);
  return { db, ws, counts: emptyCounts(), files: options.files ?? defaultFileCleanup, overBudget: () => now() > deadline };
}

export async function purgeItemServer(uid: string, target: PurgeTarget, db?: Firestore, options: PurgeOptions = {}): Promise<PurgeResult> {
  const adminDb = db ?? getAdminDb();
  const ws = await requireWorkspaceAdmin(adminDb, uid);
  const id = typeof target?.id === 'string' ? target.id.trim() : '';
  if (!id) throw new ApiError('Item tidak valid.', 400);
  const ctx = makeCtx(adminDb, ws, options);

  let done = true;
  switch (target.kind) {
    case 'student': {
      const snap = await verifiedInTrash(adminDb, ws, 'students', id);
      done = await purgeStudents(ctx, [snap]);
      break;
    }
    case 'assignment': {
      await purgeAssignment(ctx, await verifiedInTrash(adminDb, ws, 'assignments', id));
      break;
    }
    case 'column': {
      await purgeColumn(ctx, await verifiedInTrash(adminDb, ws, 'grade_columns', id));
      break;
    }
    case 'class': {
      const className = normalizeClassName(id);
      // Hanya siswa yang terhapus lewat "hapus kelas" (punya deletedBatchId); yang dihapus satu per satu adalah item sendiri.
      const students = (await deletedStudentsOf(ctx, className)).filter((s) => !!s.get('deletedBatchId'));
      if (students.length === 0) throw new ApiError(`Kelas "${className}" tidak ditemukan di Sampah.`, 404);
      done = await purgeStudents(ctx, students);
      break;
    }
    default:
      throw new ApiError('Jenis item tidak valid.', 400);
  }

  logger.info('trash.purged', { uid, workspaceId: ws, scope: target.kind, itemId: id, done, counts: ctx.counts });
  return { done, counts: ctx.counts };
}

export async function purgeAllServer(uid: string, db?: Firestore, options: PurgeOptions = {}): Promise<PurgeResult> {
  const adminDb = db ?? getAdminDb();
  const ws = await requireWorkspaceAdmin(adminDb, uid);
  const ctx = makeCtx(adminDb, ws, options);

  const deletedOnly = async (collection: string) => {
    const snap = await adminDb.collection(collection).where('workspaceId', '==', ws).get();
    return snap.docs.filter((d) => isDeleted(d.data()));
  };

  let done = true;
  for (const a of await deletedOnly('assignments')) {
    if (ctx.overBudget()) { done = false; break; }
    await purgeAssignment(ctx, a);
  }
  if (done) {
    for (const c of await deletedOnly('grade_columns')) {
      if (ctx.overBudget()) { done = false; break; }
      await purgeColumn(ctx, c);
    }
  }
  if (done) done = await purgeStudents(ctx, await deletedStudentsOf(ctx));

  logger.info('trash.purged', { uid, workspaceId: ws, scope: 'all', done, counts: ctx.counts });
  return { done, counts: ctx.counts };
}
