import { getDocument, getDocumentFromCache } from '../adapters/firestoreAdapter';
import { postToServer } from '../adapters/serverApiAdapter';
import { COLLECTIONS } from '../config/constants';

type StudentProfileData = { studentId: string; workspaceId: string; className: string; name: string; nis: string; accessCode: string };

// Klaim kode akses dilakukan SERVER (POST /api/student/claim): client tidak
// boleh membaca student_login_codes atau membuat student_profiles sendiri
// (firestore.rules), supaya kode tidak bisa ditebak massal dari akun anonim.
export async function claimAccessCodeOnServer(accessCode: string, authUid: string) {
  const { profile } = await postToServer<{ profile: StudentProfileData }>('/api/student/claim', { accessCode });
  return { id: authUid, ...profile };
}

// Dipakai murni untuk memicu koneksi Firestore lebih awal (lihat
// studentAuthService.warmupConnection) — hasilnya tidak dipakai. Dokumen ini
// memang tak terbaca (ditolak rules) dan itu tidak apa-apa: koneksinya tetap
// ter-negosiasi.
export async function warmupConnection() {
  try {
    await getDocument(COLLECTIONS.STUDENT_PROFILES, '__warmup__');
  } catch {
    // diabaikan
  }
}

export async function getStudentProfile(authUid: string) {
  if (!authUid) return null;
  return getDocument(COLLECTIONS.STUDENT_PROFILES, authUid);
}

export async function getCachedStudentProfile(authUid: string) {
  if (!authUid) return null;
  return getDocumentFromCache(COLLECTIONS.STUDENT_PROFILES, authUid);
}
