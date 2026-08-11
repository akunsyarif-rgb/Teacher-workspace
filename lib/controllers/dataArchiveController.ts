import * as dataArchiveService from '../services/dataArchiveService';
import { DateRange } from '../utils/periodRange';

export async function fetchArchiveCounts(workspaceId: string, range: DateRange, className?: string) {
  return dataArchiveService.getArchiveCounts(workspaceId, range, className);
}
