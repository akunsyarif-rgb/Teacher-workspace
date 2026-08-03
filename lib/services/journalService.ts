import * as journalRepository from '../repositories/journalRepository';

export async function listJournalEntries(className: string) {
  if (!className) return [];
  return journalRepository.getJournalsByClass(className);
}

export async function createJournalEntry(
  className: string,
  subject: string,
  data: { topic: string; notes: string }
) {
  if (!className) throw new Error('Kelas tidak valid.');
  if (!data.topic || !data.topic.trim()) {
    throw new Error('Materi wajib diisi.');
  }
  return journalRepository.createJournal({
    className,
    subject: subject.trim(),
    topic: data.topic.trim(),
    notes: data.notes?.trim() || '-',
    date: new Date().toISOString().split('T')[0],
  });
}

export async function removeJournalEntry(id: string) {
  return journalRepository.deleteJournal(id);
}
