import * as journalService from '../services/journalService';

export async function fetchJournalHistory(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return journalService.listJournalEntries(workspaceId, className);
}

export async function submitJournalEntry(
  workspaceId: string,
  className: string,
  subject: string,
  data: { topic: string; notes: string },
  scheduleId?: string | null
) {
  return journalService.createJournalEntry(workspaceId, className, subject, data, scheduleId);
}

export async function deleteJournalEntry(id: string) {
  return journalService.removeJournalEntry(id);
}
