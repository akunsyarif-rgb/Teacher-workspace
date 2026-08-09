import { getDocuments, deleteDocument, batchWrite, generateId, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';
import { generateAccessCode } from '../utils/accessCode';

export async function getAllStudents(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.STUDENTS, [['workspaceId', '==', workspaceId]]);
}

export async function getStudentsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const students = await getDocuments(COLLECTIONS.STUDENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
  return students.sort((a: any, b: any) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
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

// Setiap siswa dapat accessCode unik untuk login ke Student Companion —
// disimpan juga sebagai dokumen terpisah di student_login_codes (id
// dokumen = kode itu sendiri) supaya alur klaim akun bisa mencari
// berdasarkan kode tanpa perlu query koleksi students yang lebih sensitif.
export async function createStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const id = generateId(COLLECTIONS.STUDENTS);
  const accessCode = generateAccessCode();
  const operations: BatchOperation[] = [
    {
      type: 'set',
      collectionName: COLLECTIONS.STUDENTS,
      id,
      data: { ...data, workspaceId, accessCode, createdAt: new Date().toISOString() },
    },
    {
      type: 'set',
      collectionName: COLLECTIONS.STUDENT_LOGIN_CODES,
      id: accessCode,
      data: buildLoginCodeDoc(id, workspaceId, data),
    },
  ];
  await batchWrite(operations);
  return { id, ...data, workspaceId, accessCode };
}

export async function createStudentsBatch(
  workspaceId: string,
  students: { name: string; nis: string; className: string }[]
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const operations: BatchOperation[] = [];
  students.forEach((student) => {
    const id = generateId(COLLECTIONS.STUDENTS);
    const accessCode = generateAccessCode();
    operations.push({
      type: 'set',
      collectionName: COLLECTIONS.STUDENTS,
      id,
      data: { ...student, workspaceId, accessCode, createdAt: new Date().toISOString() },
    });
    operations.push({
      type: 'set',
      collectionName: COLLECTIONS.STUDENT_LOGIN_CODES,
      id: accessCode,
      data: buildLoginCodeDoc(id, workspaceId, student),
    });
  });

  await batchWrite(operations);
  return students.length;
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

export async function deleteStudent(id: string) {
  return deleteDocument(COLLECTIONS.STUDENTS, id);
}

// Hapus seluruh siswa satu kelas sekaligus (mis. kelas percobaan/salah
// input) — satu batch commit, konsisten dengan pola createStudentsBatch.
export async function deleteStudentsByClass(workspaceId: string, className: string) {
  const students = await getStudentsByClass(workspaceId, className);
  if (students.length === 0) return 0;

  const operations: BatchOperation[] = students.map((student: any) => ({
    type: 'delete',
    collectionName: COLLECTIONS.STUDENTS,
    id: student.id,
  }));

  await batchWrite(operations);
  return students.length;
}
