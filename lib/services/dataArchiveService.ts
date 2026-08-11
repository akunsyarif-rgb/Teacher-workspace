import * as dataArchiveRepository from '../repositories/dataArchiveRepository';
import { DateRange } from '../utils/periodRange';

export async function getArchiveCounts(workspaceId: string, range: DateRange, className?: string) {
  if (!workspaceId) return { counts: {}, studentCount: 0 };
  const [counts, studentCount] = await Promise.all([
    dataArchiveRepository.countLifecycleData(workspaceId, range, className),
    dataArchiveRepository.countStudentsInWorkspace(workspaceId),
  ]);
  return { counts, studentCount };
}
