import * as dataCleanupService from '../services/dataCleanupService';
import { DateRange } from '../utils/periodRange';
import { clearAllCached } from '../utils/sessionCache';

export async function fetchCleanupPreview(
  workspaceId: string,
  dataTypeKeys: string[],
  range: DateRange,
  className?: string
) {
  return dataCleanupService.previewCleanup(workspaceId, dataTypeKeys, range, className);
}

export async function submitCleanup(
  workspaceId: string,
  dataTypeKeys: string[],
  range: DateRange,
  className?: string
) {
  const result = await dataCleanupService.executeCleanup(workspaceId, dataTypeKeys, range, className);
  clearAllCached();
  return result;
}
