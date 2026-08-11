import { getAdminDb } from './firebaseAdmin';

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

  const oldName = oldNameInput.trim();
  const newName = newNameInput.trim();
  if (!oldName) throw new Error('Kelas asal tidak valid.');
  if (!newName) throw new Error('Nama kelas baru wajib diisi.');
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

  for (let i = 0; i < refsToUpdate.length; i += ADMIN_BATCH_LIMIT) {
    const chunk = refsToUpdate.slice(i, i + ADMIN_BATCH_LIMIT);
    const batch = adminDb.batch();
    chunk.forEach((ref) => batch.update(ref, { className: newName }));
    await batch.commit();
  }

  return { renamedCount: refsToUpdate.length, className: newName };
}
