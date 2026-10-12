import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getJournalsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return adapterFor(COLLECTIONS.JOURNALS).getDocuments(COLLECTIONS.JOURNALS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

// Rentang tanggal saja (dipakai TimelineTab) — bukan seluruh riwayat
// kelas. Timeline menumpuk terus seiring tahun ajaran berjalan (beda dari
// getJournalsByClass yang memang dipakai jurnal harian, jumlahnya wajar
// karena sekadar cek "hari ini sudah diisi atau belum"). Sama pola dengan
// getJournalsInRange di dashboardRepository.ts — lihat komentar di sana.
export async function getJournalsByClassInRange(
  workspaceId: string,
  className: string,
  startDate: string,
  endDate: string
) {
  if (!workspaceId || !className) return [];
  return adapterFor(COLLECTIONS.JOURNALS).getDocuments(COLLECTIONS.JOURNALS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ]);
}

// Dipakai supaya jurnal hari ini bisa dideteksi ("○ Belum diisi" vs
// "✓ Tersimpan") dan diedit di tempat, bukan cuma dihapus-lalu-tulis-ulang.
// Tiga filter ==, tidak butuh composite index — sama seperti
// attendanceRepository.findTodayAttendance.
export async function findTodayJournal(
  workspaceId: string,
  className: string,
  scheduleId: string | null,
  date: string
) {
  if (!workspaceId || !className) return null;
  const docs = await adapterFor(COLLECTIONS.JOURNALS).getDocuments(COLLECTIONS.JOURNALS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
    ['date', '==', date],
  ]);
  if (scheduleId) {
    return (docs.find((d: any) => d.scheduleId === scheduleId) as any) ?? null;
  }
  return (docs.find((d: any) => !d.scheduleId) as any) ?? (docs[0] as any) ?? null;
}

export async function createJournal(data: Record<string, any>) {
  return adapterFor(COLLECTIONS.JOURNALS).addDocument(COLLECTIONS.JOURNALS, data);
}

export async function updateJournal(id: string, data: Record<string, any>) {
  return adapterFor(COLLECTIONS.JOURNALS).updateDocument(COLLECTIONS.JOURNALS, id, data);
}

export async function deleteJournal(id: string) {
  return adapterFor(COLLECTIONS.JOURNALS).deleteDocument(COLLECTIONS.JOURNALS, id);
}
