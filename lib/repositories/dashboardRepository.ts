import { getDocuments } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAllStudentsForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.STUDENTS, [['workspaceId', '==', workspaceId]]);
}

export async function getAllJournalsForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.JOURNALS, [['workspaceId', '==', workspaceId]]);
}

export async function getAllSchedulesForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.SCHEDULES, [['workspaceId', '==', workspaceId]]);
}

// TAMBAH: Ambil semua attendances untuk summary
export async function getAllAttendancesForSummary(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.ATTENDANCES, [['workspaceId', '==', workspaceId]]);
}
