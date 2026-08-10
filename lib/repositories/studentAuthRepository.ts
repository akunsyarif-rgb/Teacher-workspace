import { getDocument, batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getLoginCode(accessCode: string) {
  if (!accessCode) return null;
  return getDocument(COLLECTIONS.STUDENT_LOGIN_CODES, accessCode);
}

// Dipakai murni untuk memicu koneksi Firestore lebih awal (lihat
// studentAuthService.warmupConnection) — hasilnya (null, kode ini memang
// tidak pernah ada) tidak dipakai sama sekali.
export async function warmupConnection() {
  await getDocument(COLLECTIONS.STUDENT_LOGIN_CODES, '__warmup__');
}

export async function getStudentProfile(authUid: string) {
  if (!authUid) return null;
  return getDocument(COLLECTIONS.STUDENT_PROFILES, authUid);
}

export async function saveStudentProfile(
  authUid: string,
  data: { studentId: string; workspaceId: string; className: string; name: string; nis: string }
) {
  const operations: BatchOperation[] = [
    { type: 'set', collectionName: COLLECTIONS.STUDENT_PROFILES, id: authUid, data },
  ];
  await batchWrite(operations);
  return { id: authUid, ...data };
}
