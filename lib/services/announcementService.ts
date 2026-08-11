import * as announcementRepository from '../repositories/announcementRepository';
import { getWitaDateString } from '../utils/witaDate';

// Pengumuman selalu diurutkan terbaru di atas — baik untuk guru maupun
// siswa yang paling butuh melihat yang barusan diumumkan.
function sortNewestFirst(announcements: any[]) {
  return announcements.sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
}

export async function listAnnouncements(workspaceId: string, className: string) {
  const announcements = await announcementRepository.getAnnouncementsByClass(workspaceId, className);
  return sortNewestFirst(announcements);
}

export async function createAnnouncement(
  workspaceId: string,
  className: string,
  subject: string,
  data: { title: string; body: string }
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  if (!className) throw new Error('Kelas tidak valid.');
  if (!data.title || !data.title.trim()) throw new Error('Judul pengumuman wajib diisi.');
  if (!data.body || !data.body.trim()) throw new Error('Isi pengumuman wajib diisi.');

  return announcementRepository.createAnnouncement({
    workspaceId,
    className,
    subject: subject.trim(),
    title: data.title.trim(),
    body: data.body.trim(),
    date: getWitaDateString(),
  });
}

export async function removeAnnouncement(id: string) {
  return announcementRepository.deleteAnnouncement(id);
}
