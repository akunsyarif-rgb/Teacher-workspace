import * as journalService from '../services/journalService';

export async function fetchJournalHistory(className: string) {
  if (!className) return [];
  return journalService.listJournalEntries(className);
}

export async function submitJournalEntry(
  className: string,
  subject: string,
  data: { topic: string; notes: string }
) {
  return journalService.createJournalEntry(className, subject, data);
}

export async function deleteJournalEntry(id: string) {
  return journalService.removeJournalEntry(id);
}
