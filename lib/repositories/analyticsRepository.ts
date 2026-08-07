import { getDocuments } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

// Assignments & submissions diambil satu kali per workspace, bukan
// per-kelas berulang: satu query jauh lebih murah daripada N query, dan
// pengelompokannya dilakukan di service.
export async function getAssignmentsInWorkspace(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.ASSIGNMENTS, [['workspaceId', '==', workspaceId]]);
}

export async function getSubmissionsInWorkspace(workspaceId: string) {
  if (!workspaceId) return [];
  return getDocuments(COLLECTIONS.SUBMISSIONS, [['workspaceId', '==', workspaceId]]);
}
