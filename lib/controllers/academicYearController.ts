import * as academicYearService from '../services/academicYearService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function academicYearsCacheKey(workspaceId: string) {
  return `academicYears:${workspaceId}`;
}

export async function fetchAcademicYears(workspaceId: string) {
  if (!workspaceId) return [];
  return withCache(academicYearsCacheKey(workspaceId), () => academicYearService.listAcademicYears(workspaceId));
}

export async function fetchActiveAcademicYear(workspaceId: string) {
  if (!workspaceId) return null;
  return academicYearService.getActiveAcademicYear(workspaceId);
}

export async function submitStartNewAcademicYear(workspaceId: string, label: string, startDate: string) {
  const result = await academicYearService.startNewAcademicYear(workspaceId, label, startDate);
  clearAllCached();
  return result;
}
