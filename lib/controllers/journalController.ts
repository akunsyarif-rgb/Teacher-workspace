import * as journalService from '../services/journalService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function journalHistoryCacheKey(workspaceId: string, className: string) {
  return `journalHistory:${workspaceId}:${className}`;
}

export async function fetchJournalHistory(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(journalHistoryCacheKey(workspaceId, className), () =>
    journalService.listJournalEntries(workspaceId, className)
  );
}

export async function fetchTodayJournal(workspaceId: string, className: string, scheduleId?: string | null) {
  return journalService.loadTodayJournal(workspaceId, className, scheduleId);
}

export async function submitJournalEntry(
  existingId: string | null,
  workspaceId: string,
  className: string,
  subject: string,
  data: { topic: string; notes: string },
  scheduleId?: string | null
) {
  const result = await journalService.saveJournalEntry(existingId, workspaceId, className, subject, data, scheduleId);
  clearAllCached();
  return result;
}

export async function deleteJournalEntry(id: string) {
  const result = await journalService.removeJournalEntry(id);
  clearAllCached();
  return result;
}
