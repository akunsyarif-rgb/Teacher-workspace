import { getDocuments, addDocument, updateDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAttendanceByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.ATTENDANCES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

// Rentang tanggal saja (dipakai TimelineTab) — bukan seluruh riwayat
// kelas. Timeline menumpuk terus seiring tahun ajaran berjalan (beda dari
// getAttendanceByClass yang memang sengaja menampilkan semua pertemuan di
// halaman Presensi, lihat README.md). Sama pola dengan getAttendancesInRange
// di dashboardRepository.ts.
export async function getAttendanceByClassInRange(
  workspaceId: string,
  className: string,
  startDate: string,
  endDate: string
) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.ATTENDANCES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
    ['date', '>=', startDate],
    ['date', '<=', endDate],
  ]);
}

// Dipakai auto-save presensi: cari dokumen sesi HARI INI (kalau ada) supaya
// toggle status siswa meng-update dokumen yang sama, bukan bikin dokumen
// baru tiap kali. Tiga filter ==, tidak butuh composite index.
export async function findTodayAttendance(
  workspaceId: string,
  className: string,
  scheduleId: string | null,
  date: string
) {
  if (!workspaceId || !className) return null;
  const docs = await getDocuments(COLLECTIONS.ATTENDANCES, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
    ['date', '==', date],
  ]);
  if (scheduleId) {
    return (docs.find((d: any) => d.scheduleId === scheduleId) as any) ?? null;
  }
  return (docs.find((d: any) => !d.scheduleId) as any) ?? (docs[0] as any) ?? null;
}

export async function createAttendance(data: Record<string, any>) {
  return addDocument(COLLECTIONS.ATTENDANCES, data);
}

export async function updateAttendance(id: string, data: Record<string, any>) {
  return updateDocument(COLLECTIONS.ATTENDANCES, id, data);
}

export async function deleteAttendance(id: string) {
  return deleteDocument(COLLECTIONS.ATTENDANCES, id);
}
