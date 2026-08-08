import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAnnouncementsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.ANNOUNCEMENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createAnnouncement(data: Record<string, any>) {
  return addDocument(COLLECTIONS.ANNOUNCEMENTS, data);
}

export async function deleteAnnouncement(id: string) {
  return deleteDocument(COLLECTIONS.ANNOUNCEMENTS, id);
}
