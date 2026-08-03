import * as journalService from '../services/journalService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export async function fetchJournalHistory(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(`journalHistory:${workspaceId}:${className}`, () =>
    journalService.listJournalEntries(workspaceId, className)
  );
}

export async function submitJournalEntry(
  workspaceId: string,
  className: string,
  subject: string,
  data: { topic: string; notes: string },
  scheduleId?: string | null
) {
  const result = await journalService.createJournalEntry(workspaceId, className, subject, data, scheduleId);
  clearAllCached();
  return result;
}

export async function deleteJournalEntry(id: string) {
  const result = await journalService.removeJournalEntry(id);
  clearAllCached();
  return result;
}
