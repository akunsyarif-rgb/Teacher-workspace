import * as gradeService from '../services/gradeService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function gradeDataCacheKey(workspaceId: string, className: string) {
  return `gradeData:${workspaceId}:${className}`;
}

export async function fetchGradeData(workspaceId: string, className: string) {
  if (!workspaceId || !className) return { columns: [], grades: {} };
  return withCache(gradeDataCacheKey(workspaceId, className), () => gradeService.loadGradeData(workspaceId, className));
}

export async function saveGrades(
  workspaceId: string,
  className: string,
  gradesMap: Record<string, Record<string, string>>
) {
  const result = await gradeService.saveAllGrades(workspaceId, className, gradesMap);
  clearAllCached();
  return result;
}

export async function addColumn(workspaceId: string, className: string, title: string, type: string) {
  const result = await gradeService.addGradeColumn(workspaceId, className, title, type);
  clearAllCached();
  return result;
}

export async function removeColumn(id: string) {
  const result = await gradeService.removeGradeColumn(id);
  clearAllCached();
  return result;
}
