import { getAdminDb } from './firebaseAdmin';
import { adminSelect, adminUpdate, adminGetOne } from './supabaseAdmin';
import { normalizeClassName, validateClassName } from '../utils/classNameValidation';

const CLASS_SCOPED_COLLECTIONS = [
  'students','student_profiles','student_login_codes','journals','attendances','grades',
  'grade_columns','schedules','class_fund_transactions','class_inventory','student_notes',
  'assignments','submissions','announcements','student_achievements','session_skip_reasons',
];
const ADMIN_BATCH_LIMIT = 500;

type AdminDbLike = ReturnType<typeof getAdminDb>;

async function renameWithSupabase(uid: string, oldName: string, newName: string) {
  const profile = await adminGetOne<any>('teacher_profiles', 'userId', uid);
  const workspaceId = profile?.workspaceId;
  if (!workspaceId) throw new Error('Akun ini belum terhubung ke workspace mana pun.');

  const collision = await adminSelect<any>('students', [['workspaceId','==',workspaceId],['className','==',newName]]);
  if (collision.length > 0) throw new Error(`Kelas "${newName}" sudah ada. Pilih nama lain.`);

  let total = 0;
  for (const collectionName of CLASS_SCOPED_COLLECTIONS) {
    const rows = await adminSelect<any>(collectionName, [['workspaceId','==',workspaceId],['className','==',oldName]]);
    for (let i=0;i<rows.length;i+=ADMIN_BATCH_LIMIT) {
      const chunk = rows.slice(i,i+ADMIN_BATCH_LIMIT);
      await Promise.all(chunk.map((row) => adminUpdate(collectionName, [['id','==',row.id]], { className: newName })));
      total += chunk.length;
    }
  }
  if (total === 0) throw new Error(`Kelas "${oldName}" tidak ditemukan.`);
  return { renamedCount: total, className: newName };
}

// `db` hanya dipertahankan untuk regression test lama yang mensimulasikan
// kegagalan batch Firestore. Jalur produksi tanpa argumen memakai Supabase.
export async function renameClassServer(uid: string, oldNameInput: string, newNameInput: string, db?: AdminDbLike) {
  const oldName = normalizeClassName(oldNameInput);
  if (!oldName) throw new Error('Kelas asal tidak valid.');
  const validation = validateClassName(newNameInput);
  if (!validation.valid) throw new Error(validation.error);
  const newName = validation.value;
  if (oldName === newName) throw new Error('Nama kelas baru sama dengan nama sekarang.');

  if (!db) return renameWithSupabase(uid, oldName, newName);

  const profileSnap = await db.collection('teacher_profiles').doc(uid).get();
  const workspaceId = profileSnap.exists ? (profileSnap.data() as { workspaceId?: string })?.workspaceId : null;
  if (!workspaceId) throw new Error('Akun ini belum terhubung ke workspace mana pun.');

  const collisionSnap = await db.collection('students').where('workspaceId','==',workspaceId).where('className','==',newName).limit(1).get();
  if (!collisionSnap.empty) throw new Error(`Kelas "${newName}" sudah ada. Pilih nama lain.`);

  const refsToUpdate: FirebaseFirestore.DocumentReference[] = [];
  for (const collectionName of CLASS_SCOPED_COLLECTIONS) {
    const snap = await db.collection(collectionName).where('workspaceId','==',workspaceId).where('className','==',oldName).get();
    snap.docs.forEach((docSnap) => refsToUpdate.push(docSnap.ref));
  }
  if (refsToUpdate.length === 0) throw new Error(`Kelas "${oldName}" tidak ditemukan.`);

  let committed = 0;
  for (let i=0;i<refsToUpdate.length;i+=ADMIN_BATCH_LIMIT) {
    const chunk = refsToUpdate.slice(i,i+ADMIN_BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach((ref) => batch.update(ref,{className:newName}));
    try { await batch.commit(); } catch (error: unknown) {
      const sebab = error instanceof Error ? error.message : 'penyebab tidak diketahui';
      throw new Error(`Penggantian nama berhenti di tengah jalan: ${committed} dari ${refsToUpdate.length} dokumen sudah memakai nama "${newName}", sisanya masih "${oldName}". Periksa konsistensi data sebelum mencoba lagi. (${sebab})`);
    }
    committed += chunk.length;
  }
  return { renamedCount: refsToUpdate.length, className: newName };
}
