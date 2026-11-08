import { getDocuments, batchWrite, BatchOperation, softDeleteDocument, restoreDocument } from '../adapters/firestoreAdapter';
import { activeOnly, deletedOnly } from '../utils/softDelete';
import { COLLECTIONS } from '../config/constants';
import { generateAccessCode } from '../utils/accessCode';
import { postToServer } from '../adapters/serverApiAdapter';

// Semua pembacaan siswa menyaring yang di-soft-delete (lib/utils/softDelete.ts).
async function fetchAllStudents(workspaceId: string) {
  return getDocuments(COLLECTIONS.STUDENTS, [['workspaceId', '==', workspaceId]]);
}

export async function getAllStudents(workspaceId: string) {
  if (!workspaceId) return [];
  return activeOnly(await fetchAllStudents(workspaceId));
}

// Untuk Recycle Bin / pemulihan.
export async function getDeletedStudents(workspaceId: string) {
  if (!workspaceId) return [];
  return deletedOnly(await fetchAllStudents(workspaceId));
}

export async function getStudentsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const students = await getDocuments(COLLECTIONS.STUDENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
  return activeOnly(students).sort((a: any, b: any) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
}

// Dokumen kode akses memuat SALINAN identitas siswa (nama, kelas, NIS),
// bukan cuma studentId. Bukan denormalisasi demi kecepatan: saat siswa
// menukar kode, ia belum punya student_profiles maupun teacher_profiles,
// sehingga rules menolak semua bacaan ke koleksi students. Dokumen inilah
// satu-satunya yang boleh ia baca, jadi seluruh data yang dibutuhkan alur
// klaim harus ada di sini. Lihat test "alur klaim kode akses".
function buildLoginCodeDoc(
  studentId: string,
  workspaceId: string,
  student: { name: string; className: string; nis?: string }
) {
  return {
    studentId,
    workspaceId,
    name: student.name,
    className: student.className,
    nis: student.nis || '-',
  };
}

// Pembuatan siswa (dokumen siswa + dokumen kode akses di student_login_codes)
// dilakukan SERVER (POST /api/students/create, Admin SDK), bukan batch
// Firestore dari client: batas kelas paket dan masa berlaku paket tidak bisa
// ditegakkan firestore.rules, jadi rules menutup create langsung ke students.
// Server juga yang membuat accessCode dan mengisi createdBy/createdAt.
type CreatedStudentResponse = { students: { id: string; name: string; nis: string; className: string; accessCode: string }[] };

export async function createStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const { students } = await postToServer<CreatedStudentResponse>('/api/students/create', { students: [data] });
  return { ...students[0], workspaceId };
}

export async function createStudentsBatch(
  workspaceId: string,
  students: { name: string; nis: string; className: string }[]
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const SERVER_CHUNK = 200; // sama dengan batas per permintaan di server
  let saved = 0;
  for (let i = 0; i < students.length; i += SERVER_CHUNK) {
    const res = await postToServer<CreatedStudentResponse>('/api/students/create', {
      students: students.slice(i, i + SERVER_CHUNK),
    });
    saved += res.students.length;
  }
  return saved;
}

// Siswa yang dibuat sebelum fitur Student Companion ada belum punya
// accessCode sama sekali, jadi tidak bisa login. Ini mengisikannya
// menyusul, dan aman dijalankan berulang: siswa yang sudah punya kode
// dilewati supaya kode yang terlanjur dibagikan tidak berubah.
export async function backfillAccessCodes(
  students: { id: string; accessCode?: string; name: string; className: string; nis?: string }[],
  workspaceId: string
) {
  const missing = students.filter((student) => !student.accessCode);
  if (missing.length === 0) return 0;

  const operations: BatchOperation[] = [];
  missing.forEach((student) => {
    const accessCode = generateAccessCode();
    operations.push({
      type: 'set',
      collectionName: COLLECTIONS.STUDENTS,
      id: student.id,
      data: { accessCode },
    });
    operations.push({
      type: 'set',
      collectionName: COLLECTIONS.STUDENT_LOGIN_CODES,
      id: accessCode,
      data: buildLoginCodeDoc(student.id, workspaceId, student),
    });
  });

  await batchWrite(operations);
  return missing.length;
}

// Soft delete satu siswa: dokumen hanya ditandai deletedAt. Kode aksesnya
// (student_login_codes) tidak perlu dihapus — klaim kode menolak siswa yang
// sudah di-soft-delete (lib/server/studentClaimService.ts), dan kodenya tetap
// berlaku lagi bila siswa dipulihkan. Siapa yang boleh menghapus dijaga rules
// (pembuat siswa atau OWNER/ADMIN). Hapus satu KELAS penuh lewat server
// (POST /api/classes/delete, khusus OWNER/ADMIN).
export async function deleteStudent(id: string) {
  return softDeleteDocument(COLLECTIONS.STUDENTS, id);
}

export async function restoreStudent(id: string) {
  return restoreDocument(COLLECTIONS.STUDENTS, id);
}

// Hapus / pulihkan satu KELAS penuh: lewat server (Admin SDK), khusus OWNER/ADMIN —
// rules per-dokumen tidak bisa membatasi operasi massal atas data banyak guru.
export async function deleteClassOnServer(className: string) {
  const { deletedCount } = await postToServer<{ deletedCount: number }>('/api/classes/delete', { className });
  return deletedCount;
}

export async function restoreClassOnServer(className: string) {
  const { restoredCount } = await postToServer<{ restoredCount: number }>('/api/classes/restore', { className });
  return restoredCount;
}
