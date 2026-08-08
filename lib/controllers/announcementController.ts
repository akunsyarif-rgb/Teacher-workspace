import * as announcementService from '../services/announcementService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export async function fetchAnnouncements(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(`announcements:${workspaceId}:${className}`, () =>
    announcementService.listAnnouncements(workspaceId, className)
  );
}

export async function createAnnouncement(
  workspaceId: string,
  className: string,
  subject: string,
  data: { title: string; body: string }
) {
  const result = await announcementService.createAnnouncement(workspaceId, className, subject, data);
  clearAllCached();
  return result;
}

export async function removeAnnouncement(id: string) {
  const result = await announcementService.removeAnnouncement(id);
  clearAllCached();
  return result;
}
