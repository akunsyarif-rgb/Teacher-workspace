import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import type { Doc } from '../adapters/firestoreAdapter';
import type { AnnouncementData } from '../types/models';
import { COLLECTIONS } from '../config/constants';

export async function getAnnouncementsByClass(workspaceId: string, className: string): Promise<Doc<AnnouncementData>[]> {
  if (!workspaceId || !className) return [];
  return getDocuments<AnnouncementData>(COLLECTIONS.ANNOUNCEMENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function createAnnouncement(data: Record<string, unknown>) {
  return addDocument(COLLECTIONS.ANNOUNCEMENTS, data);
}

export async function deleteAnnouncement(id: string) {
  return deleteDocument(COLLECTIONS.ANNOUNCEMENTS, id);
}
