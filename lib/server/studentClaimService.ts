import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';
import { ApiError } from './apiErrors';

export class ClaimError extends ApiError {
  // true = tebakan kode salah/tidak valid -> dihitung ke rate limit.
  countsAsFailure: boolean;
  constructor(message: string, status: number, countsAsFailure: boolean) {
    super(message, status);
    this.countsAsFailure = countsAsFailure;
  }
}

export type StudentProfileData = {
  studentId: string;
  workspaceId: string;
  className: string;
  name: string;
  nis: string;
  accessCode: string;
};

type AdminDbLike = ReturnType<typeof getAdminDb>;

const CODE_PATTERN = /^[A-Z0-9]{4,32}$/;

// Menautkan akun (anonim) siswa ke satu siswa lewat kode akses dari guru.
// Dulu dilakukan dari client (baca student_login_codes langsung + tulis
// student_profiles yang dicocokkan rules) — itu memaksa `get` terbuka untuk
// SEMUA akun login, termasuk akun anonim yang bisa dibuat gratis tanpa batas,
// sehingga kode bisa ditebak massal tanpa pembatas. Sekarang hanya lewat
// server: rules menutup login_codes untuk client, profil dibuat Admin SDK,
// dan percobaan gagal dibatasi di route (lib/server/rateLimit.ts).
export async function claimStudentAccessCodeServer(
  uid: string,
  rawCode: unknown,
  db?: AdminDbLike
): Promise<StudentProfileData> {
  const adminDb = db ?? getAdminDb();

  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!code) throw new ClaimError('Kode akses wajib diisi.', 400, false);
  if (!CODE_PATTERN.test(code)) {
    throw new ClaimError('Kode akses tidak ditemukan. Periksa kembali kode dari gurumu.', 404, true);
  }

  const codeSnap = await adminDb.collection('student_login_codes').doc(code).get();
  if (!codeSnap.exists) {
    throw new ClaimError('Kode akses tidak ditemukan. Periksa kembali kode dari gurumu.', 404, true);
  }
  const loginCode = codeSnap.data() as Partial<StudentProfileData>;

  if (!loginCode.studentId || !loginCode.workspaceId) {
    throw new ClaimError('Kode akses tidak ditemukan. Periksa kembali kode dari gurumu.', 404, true);
  }
  if (!loginCode.className || !loginCode.name) {
    throw new ClaimError('Kode akses ini dibuat versi lama. Minta gurumu membuat ulang kode akses.', 409, false);
  }

  // Siswa yang sudah dihapus: kodenya seharusnya ikut terhapus, tapi jangan
  // bergantung pada itu.
  const studentSnap = await adminDb.collection('students').doc(loginCode.studentId).get();
  if (!studentSnap.exists || studentSnap.data()?.workspaceId !== loginCode.workspaceId) {
    throw new ClaimError('Kode akses tidak ditemukan. Periksa kembali kode dari gurumu.', 404, true);
  }

  const profile: StudentProfileData = {
    studentId: loginCode.studentId,
    workspaceId: loginCode.workspaceId,
    className: loginCode.className,
    name: loginCode.name,
    nis: loginCode.nis || '-',
    accessCode: code,
  };

  // Identitas terkunci begitu terklaim (sama seperti aturan lama
  // `student_profiles update: false`): akun ini tidak boleh ditimpa ke siswa lain.
  const profileRef = adminDb.collection('student_profiles').doc(uid);
  const existing = await profileRef.get();
  if (existing.exists) {
    if (existing.data()?.studentId === profile.studentId) return existing.data() as StudentProfileData;
    throw new ClaimError('Perangkat ini sudah masuk sebagai siswa lain. Keluar dulu sebelum memakai kode lain.', 409, false);
  }

  try {
    await profileRef.create({ ...profile, createdAt: FieldValue.serverTimestamp() });
  } catch (error) {
    // Dua permintaan bersamaan dari akun yang sama: yang kalah membaca hasil pemenang.
    const again = await profileRef.get();
    if (again.exists && again.data()?.studentId === profile.studentId) return again.data() as StudentProfileData;
    throw error;
  }
  return profile;
}
