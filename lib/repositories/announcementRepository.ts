import { adapterFor } from '../adapters/dataAdapter';
import { COLLECTIONS } from '../config/constants';

export async function getAnnouncementsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return adapterFor(COLLECTIONS.ANNOUNCEMENTS).getDocuments(COLLECTIONS.ANNOUNCEMENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createAnnouncement(data: Record<string, any>) {
  return adapterFor(COLLECTIONS.ANNOUNCEMENTS).addDocument(COLLECTIONS.ANNOUNCEMENTS, data);
}

export async function deleteAnnouncement(id: string) {
  return adapterFor(COLLECTIONS.ANNOUNCEMENTS).deleteDocument(COLLECTIONS.ANNOUNCEMENTS, id);
}
