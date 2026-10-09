import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

const C = COLLECTIONS.SESSION_SKIP_REASONS;

// Satu dokumen per (scheduleId, date) — sama seperti pola upsert-per-sesi
// yang dipakai findTodayAttendance/findTodayJournal, supaya guru bisa
// mengganti alasan yang sudah dicatat tanpa membuat duplikat.
export async function findByScheduleAndDate(workspaceId: string, scheduleId: string, date: string) {
  if (!workspaceId || !scheduleId) return null;
  const docs = await adapterFor(C).getDocuments(C, [
    ['workspaceId', '==', workspaceId],
    ['scheduleId', '==', scheduleId],
    ['date', '==', date],
  ]);
  return docs[0] ?? null;
}

// Dipakai dashboardService untuk melampirkan alasan ke setiap sesi "Perlu
// Konfirmasi" hari ini sekaligus (bukan satu-satu per scheduleId).
export async function getByDate(workspaceId: string, date: string) {
  if (!workspaceId) return [];
  return adapterFor(C).getDocuments(C, [
    ['workspaceId', '==', workspaceId],
    ['date', '==', date],
  ]);
}

export async function createSkipReason(data: Record<string, unknown>) {
  return adapterFor(C).addDocument(C, data);
}

export async function updateSkipReason(id: string, data: Record<string, unknown>) {
  return adapterFor(C).updateDocument(C, id, data);
}
