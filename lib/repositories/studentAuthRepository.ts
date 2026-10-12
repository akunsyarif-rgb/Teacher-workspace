import type { BatchOperation } from '../adapters/firestoreAdapter';
import { adapterFor } from '../adapters/dataAdapter';
import { isSupabaseCollection } from '../config/dataBackend';
import { COLLECTIONS } from '../config/constants';

// Unit siswa (students + student_login_codes + student_profiles) beralih BERSAMAAN lewat dataBackend (UNITS).
export const usesSupabaseStudentAuth = () => isSupabaseCollection(COLLECTIONS.STUDENT_LOGIN_CODES);

export async function getLoginCode(accessCode: string) {
  if (!accessCode) return null;
  return adapterFor(COLLECTIONS.STUDENT_LOGIN_CODES).getDocument(COLLECTIONS.STUDENT_LOGIN_CODES, accessCode);
}

// Dipakai murni untuk memicu koneksi Firestore lebih awal (lihat
// studentAuthService.warmupConnection) — hasilnya (null, kode ini memang
// tidak pernah ada) tidak dipakai sama sekali. Tidak relevan untuk Supabase.
export async function warmupConnection() {
  if (usesSupabaseStudentAuth()) return;
  await adapterFor(COLLECTIONS.STUDENT_LOGIN_CODES).getDocument(COLLECTIONS.STUDENT_LOGIN_CODES, '__warmup__');
}

export async function getStudentProfile(authUid: string) {
  if (!authUid) return null;
  return adapterFor(COLLECTIONS.STUDENT_PROFILES).getDocument(COLLECTIONS.STUDENT_PROFILES, authUid);
}

export async function getCachedStudentProfile(authUid: string) {
  if (!authUid) return null;
  return adapterFor(COLLECTIONS.STUDENT_PROFILES).getDocumentFromCache(COLLECTIONS.STUDENT_PROFILES, authUid);
}

export async function saveStudentProfile(
  authUid: string,
  data: { studentId: string; workspaceId: string; className: string; name: string; nis: string; accessCode: string }
) {
  if (usesSupabaseStudentAuth()) {
    // Di Supabase profil dibuat HANYA oleh RPC claim_student_profile (hak tulis klien dicabut).
    throw new Error('saveStudentProfile tidak dipakai pada Supabase; gunakan claimProfileViaRpc.');
  }
  const operations: BatchOperation[] = [
    { type: 'set', collectionName: COLLECTIONS.STUDENT_PROFILES, id: authUid, data },
  ];
  await adapterFor(COLLECTIONS.STUDENT_PROFILES).batchWrite(operations);
  return { id: authUid, ...data };
}

// Supabase: satu RPC atomik memvalidasi kode login dan membuat/mengembalikan profil milik pemanggil (idempoten).
export async function claimProfileViaRpc(authUid: string, code: string) {
  const adapter = adapterFor(COLLECTIONS.STUDENT_LOGIN_CODES);
  if (!adapter.rpc) throw new Error('RPC tidak tersedia pada backend ini.');
  const rows = await adapter.rpc('claim_student_profile', { p_code: code });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.student_id || !row.workspace_id || !row.class_name) throw new Error('Respons klaim tidak lengkap dari server.');
  return {
    id: authUid,
    studentId: row.student_id as string,
    workspaceId: row.workspace_id as string,
    className: row.class_name as string,
    name: (row.name as string) ?? '',
    nis: (row.nis as string) || '-',
  };
}
