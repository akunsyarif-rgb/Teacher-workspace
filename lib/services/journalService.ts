import * as journalRepository from '../repositories/journalRepository';

export async function listJournalEntries(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return journalRepository.getJournalsByClass(workspaceId, className);
}

export async function createJournalEntry(
  workspaceId: string,
  className: string,
  subject: string,
  data: { topic: string; notes: string },
  scheduleId?: string | null
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  if (!className) throw new Error('Kelas tidak valid.');
  if (!data.topic || !data.topic.trim()) {
    throw new Error('Materi wajib diisi.');
  }
  return journalRepository.createJournal({
    workspaceId,
    className,
    subject: subject.trim(),
    topic: data.topic.trim(),
    notes: data.notes?.trim() || '-',
    date: new Date().toISOString().split('T')[0],
    scheduleId: scheduleId ?? null,
  });
}

export async function removeJournalEntry(id: string) {
  return journalRepository.deleteJournal(id);
}
