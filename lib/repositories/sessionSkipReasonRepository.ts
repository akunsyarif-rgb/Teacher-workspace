import { getDocuments, addDocument, updateDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';
import { isSupabaseCollection } from '../config/dataBackend';
import { getSupabaseAdapter } from '../adapters/supabaseClient';

// Koleksi ini bisa dialihkan ke Supabase per-flag (default MATI = Firestore).
// Pemilihan backend hanya di sini; service/controller tidak tahu bedanya.
const usesSupabase = () => isSupabaseCollection(COLLECTIONS.SESSION_SKIP_REASONS);

// Satu dokumen per (scheduleId, date) — sama seperti pola upsert-per-sesi
// yang dipakai findTodayAttendance/findTodayJournal, supaya guru bisa
// mengganti alasan yang sudah dicatat tanpa membuat duplikat.
export async function findByScheduleAndDate(workspaceId: string, scheduleId: string, date: string) {
  if (!workspaceId || !scheduleId) return null;
  const filters: [string, string, unknown][] = [
    ['workspaceId', '==', workspaceId],
    ['scheduleId', '==', scheduleId],
    ['date', '==', date],
  ];
  const docs = usesSupabase()
    ? await getSupabaseAdapter().getDocuments(COLLECTIONS.SESSION_SKIP_REASONS, filters)
    : await getDocuments(COLLECTIONS.SESSION_SKIP_REASONS, filters);
  return (docs[0] as { id: string } | undefined) ?? null;
}

// Dipakai dashboardService untuk melampirkan alasan ke setiap sesi "Perlu
// Konfirmasi" hari ini sekaligus (bukan satu-satu per scheduleId).
export async function getByDate(workspaceId: string, date: string) {
  if (!workspaceId) return [];
  const filters: [string, string, unknown][] = [
    ['workspaceId', '==', workspaceId],
    ['date', '==', date],
  ];
  return usesSupabase()
    ? getSupabaseAdapter().getDocuments(COLLECTIONS.SESSION_SKIP_REASONS, filters)
    : getDocuments(COLLECTIONS.SESSION_SKIP_REASONS, filters);
}

export async function createSkipReason(data: Record<string, unknown>) {
  return usesSupabase()
    ? getSupabaseAdapter().addDocument(COLLECTIONS.SESSION_SKIP_REASONS, data)
    : addDocument(COLLECTIONS.SESSION_SKIP_REASONS, data);
}

export async function updateSkipReason(id: string, data: Record<string, unknown>) {
  return usesSupabase()
    ? getSupabaseAdapter().updateDocument(COLLECTIONS.SESSION_SKIP_REASONS, id, data)
    : updateDocument(COLLECTIONS.SESSION_SKIP_REASONS, id, data);
}
