import { supabaseRequest } from '@/src/config/supabase';
import { getDocument, batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getLoginCode(accessCode: string) {
  if (!accessCode) return null;
  const { data } = await supabaseRequest<Array<{
    student_id: string;
    workspace_id: string;
    name: string;
    class_name: string;
    nis: string;
  }>>('/rest/v1/rpc/claim_student_login_code', {
    method: 'POST',
    body: JSON.stringify({ p_code: accessCode }),
  });
  const row = data?.[0];
  if (!row) return null;
  return {
    id: accessCode,
    studentId: row.student_id,
    workspaceId: row.workspace_id,
    name: row.name,
    className: row.class_name,
    nis: row.nis || '-',
  };
}

// Supabase tidak perlu warm-up query Firestore. Tetap dipertahankan sebagai
// no-op async agar service dan UI lama tidak perlu diubah serentak.
export async function warmupConnection() {
  return undefined;
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
