import { getAdminDb } from './firebaseAdmin';
import { normalizeClassName, validateClassName } from '../utils/classNameValidation';

// Semua koleksi yang punya field className langsung, TERMASUK
// student_profiles — satu-satunya alasan operasi ini harus lewat Admin
// SDK (bukan batchWrite client seperti operasi kelas lainnya): rules
// student_profiles sengaja `allow update: if false` (identitas Student
// Companion terkunci begitu ter-klaim, lihat firestore.rules). Tanpa
// merapikan className di sini juga, siswa yang sudah pernah login diam-diam
// kehilangan akses baca jurnal/presensi/pengumuman kelasnya begitu gurunya
// mengganti nama kelas, karena rules siswa mencocokkan className profil
// terhadap className dokumen yang dibaca (isStudentInClass).
const CLASS_SCOPED_COLLECTIONS = [
  'students',
  'student_profiles',
  // student_login_codes menyimpan SALINAN className (lihat buildLoginCodeDoc
  // di studentRepository.ts) yang dipakai claimAccessCode() saat siswa
  // pertama kali klaim kodenya — bukan referensi ke dokumen students. Tanpa
  // ikut dirapikan di sini, siswa yang belum pernah login saat rename terjadi
  // akan mendapat student_profiles.className yang sudah basi begitu ia
  // akhirnya login, walau dokumen students-nya sendiri sudah benar.
  'student_login_codes',
  'journals',
  'attendances',
  'grades',
  'grade_columns',
  'schedules',
  'class_fund_transactions',
  'class_inventory',
  'student_notes',
  'assignments',
  'announcements',
  'student_achievements',
  'session_skip_reasons',
];

const ADMIN_BATCH_LIMIT = 500;

// TEACHER (bukan cuma OWNER/ADMIN) sengaja diizinkan — role TEACHER di
// workspace ini memang akses penuh tanpa isolasi per kelas (audit T4,
// dikonfirmasi "by design"), rename kelas tidak beda dengan operasi
// guru-ke-guru lain yang sudah diizinkan lintas kelas dalam satu sekolah.
export async function renameClassServer(uid: string, oldNameInput: string, newNameInput: string) {
  const adminDb = getAdminDb();

  const profileSnap = await adminDb.collection('teacher_profiles').doc(uid).get();
  const workspaceId = profileSnap.exists ? (profileSnap.data() as { workspaceId?: string })?.workspaceId : null;
  if (!workspaceId) {
    throw new Error('Akun ini belum terhubung ke workspace mana pun.');
  }

  // oldName cuma dipakai untuk mencari dokumen existing (nilai className
  // yang sudah tersimpan, apa pun bentuknya) — bukan input baru dari guru,
  // jadi cukup dirapikan spasinya, tidak perlu divalidasi ulang.
  const oldName = normalizeClassName(oldNameInput);
  if (!oldName) throw new Error('Kelas asal tidak valid.');

  // newName ADALAH input guru — validasi penuh di sini sebagai pertahanan
  // kedua (client sudah validasi juga), bukan cuma trim. Sengaja TIDAK ada
  // whitelist karakter: className bukan identifier/slug, boleh mengandung
  // spasi dan angka apa pun ("XI A KESEHATAN 1", "XI F TEKNIK 2", dst).
  const validation = validateClassName(newNameInput);
  if (!validation.valid) throw new Error(validation.error);
  const newName = validation.value;

  if (oldName === newName) throw new Error('Nama kelas baru sama dengan nama sekarang.');

  const collisionSnap = await adminDb
    .collection('students')
    .where('workspaceId', '==', workspaceId)
    .where('className', '==', newName)
    .limit(1)
    .get();
  if (!collisionSnap.empty) {
    throw new Error(`Kelas "${newName}" sudah ada. Pilih nama lain.`);
  }

  const refsToUpdate: FirebaseFirestore.DocumentReference[] = [];
  for (const collectionName of CLASS_SCOPED_COLLECTIONS) {
    const snap = await adminDb
      .collection(collectionName)
      .where('workspaceId', '==', workspaceId)
      .where('className', '==', oldName)
      .get();
    snap.docs.forEach((docSnap) => refsToUpdate.push(docSnap.ref));
  }

  if (refsToUpdate.length === 0) {
    throw new Error(`Kelas "${oldName}" tidak ditemukan.`);
  }

  // Firestore membatasi 500 operasi per batch, jadi rename kelas besar
  // TERPAKSA dipecah — dan pecahan itu tidak atomik satu sama lain. Kalau
  // sebuah chunk gagal, dokumen di chunk sebelumnya sudah memakai nama baru
  // sementara sisanya belum. Kondisi itu TIDAK boleh lewat diam-diam:
  // errornya menyebut berapa dokumen yang terlanjur berubah supaya guru tahu
  // harus memeriksa konsistensi, bukan sekadar mengulang.
  //
  // Catatan: ini hanya menangkap kegagalan yang punya error (izin, contention,
  // koneksi). Kalau function-nya sendiri dimatikan platform karena timeout,
  // tidak ada kode yang sempat jalan di sini — deteksinya jatuh ke sisi klien
  // (lihat describeHttpFailure di classController.ts) dan ke skrip
  // scripts/check-class-rename-consistency.mjs.
  let committed = 0;
  for (let i = 0; i < refsToUpdate.length; i += ADMIN_BATCH_LIMIT) {
    const chunk = refsToUpdate.slice(i, i + ADMIN_BATCH_LIMIT);
    const batch = adminDb.batch();
    chunk.forEach((ref) => batch.update(ref, { className: newName }));
    try {
      await batch.commit();
    } catch (error: unknown) {
      const sebab = error instanceof Error ? error.message : 'penyebab tidak diketahui';
      throw new Error(
        `Penggantian nama berhenti di tengah jalan: ${committed} dari ${refsToUpdate.length} dokumen sudah memakai nama "${newName}", sisanya masih "${oldName}". Periksa konsistensi data sebelum mencoba lagi. (${sebab})`
      );
    }
    committed += chunk.length;
  }

  return { renamedCount: refsToUpdate.length, className: newName };
}
