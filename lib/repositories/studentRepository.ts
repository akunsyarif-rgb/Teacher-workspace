import { getDocument, getDocuments, deleteDocument, batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';
import { generateAccessCode } from '../utils/accessCode';
import { postToServer } from '../adapters/serverApiAdapter';

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

// Menghapus dokumen siswa saja TIDAK cukup: kode aksesnya (student_login_
// codes, id dokumen = accessCode itu sendiri) tetap valid dan bisa dipakai
// klaim akun Student Companion baru yang menunjuk ke siswa yang sudah
// tidak ada — claimAccessCode() di studentAuthService sengaja tidak
// membaca koleksi students sama sekali (lihat komentarnya), jadi cuma
// menghapus dokumen kode akses ini yang benar-benar mencegahnya.
// firestore.rules sengaja melarang `list` pada student_login_codes (supaya
// kode tidak bisa dienumerasi) — makanya di sini TIDAK query koleksi itu,
// cukup pakai accessCode yang sudah tersimpan di dokumen siswa sendiri.
export async function deleteStudent(id: string) {
  const student: any = await getDocument(COLLECTIONS.STUDENTS, id);
  if (!student?.accessCode) {
    return deleteDocument(COLLECTIONS.STUDENTS, id);
  }
  await batchWrite([
    { type: 'delete', collectionName: COLLECTIONS.STUDENTS, id },
    { type: 'delete', collectionName: COLLECTIONS.STUDENT_LOGIN_CODES, id: student.accessCode },
  ]);
  return true;
}

// Hapus seluruh siswa satu kelas sekaligus (mis. kelas percobaan/salah
// input) — satu batch commit, konsisten dengan pola createStudentsBatch.
// Kode akses tiap siswa ikut dihapus (lihat catatan di deleteStudent).
export async function deleteStudentsByClass(workspaceId: string, className: string) {
  const students = await getStudentsByClass(workspaceId, className);
  if (students.length === 0) return 0;

  const operations: BatchOperation[] = [];
  students.forEach((student: any) => {
    operations.push({ type: 'delete', collectionName: COLLECTIONS.STUDENTS, id: student.id });
    if (student.accessCode) {
      operations.push({
        type: 'delete',
        collectionName: COLLECTIONS.STUDENT_LOGIN_CODES,
        id: student.accessCode,
      });
    }
  });

  await batchWrite(operations);
  return students.length;
}
