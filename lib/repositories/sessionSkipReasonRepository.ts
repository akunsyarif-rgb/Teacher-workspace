import { getDocuments, addDocument, updateDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

// Satu dokumen per (scheduleId, date) — sama seperti pola upsert-per-sesi
// yang dipakai findTodayAttendance/findTodayJournal, supaya guru bisa
// mengganti alasan yang sudah dicatat tanpa membuat duplikat.
export async function findByScheduleAndDate(workspaceId: string, scheduleId: string, date: string) {
  if (!workspaceId || !scheduleId) return null;
  const docs = await getDocuments(COLLECTIONS.SESSION_SKIP_REASONS, [
    ['workspaceId', '==', workspaceId],
    ['scheduleId', '==', scheduleId],
    ['date', '==', date],
  ]);
  return (docs[0] as any) ?? null;
}

// Dipakai dashboardService untuk melampirkan alasan ke setiap sesi "Perlu
// Konfirmasi" hari ini sekaligus (bukan satu-satu per scheduleId).
export async function getByDate(workspaceId: string, date: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.SESSION_SKIP_REASONS, [
    ['workspaceId', '==', workspaceId],
    ['date', '==', date],
  ]);
}

export async function createSkipReason(data: Record<string, any>) {
  return addDocument(COLLECTIONS.SESSION_SKIP_REASONS, data);
}

export async function updateSkipReason(id: string, data: Record<string, any>) {
  return updateDocument(COLLECTIONS.SESSION_SKIP_REASONS, id, data);
}
