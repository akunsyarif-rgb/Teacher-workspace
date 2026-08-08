import * as achievementService from '../services/achievementService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export async function fetchAchievements(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(`achievements:${workspaceId}:${className}`, () =>
    achievementService.listAchievements(workspaceId, className)
  );
}

export async function fetchAchievementsForStudent(workspaceId: string, studentId: string) {
  if (!workspaceId || !studentId) return [];
  return withCache(`achievementsForStudent:${workspaceId}:${studentId}`, () =>
    achievementService.listAchievementsForStudent(workspaceId, studentId)
  );
}

export async function submitAchievement(
  workspaceId: string,
  className: string,
  data: { studentId: string; studentName: string; title: string; notes: string }
) {
  const result = await achievementService.addAchievement(workspaceId, className, data);
  clearAllCached();
  return result;
}

export async function deleteAchievement(id: string) {
  const result = await achievementService.removeAchievement(id);
  clearAllCached();
  return result;
}

export async function countUnmigratedAchievements(workspaceId: string, className: string) {
  if (!workspaceId || !className) return 0;
  return achievementService.countUnmigratedAchievements(workspaceId, className);
}

export async function migrateLegacyAchievements(workspaceId: string, className: string) {
  const result = await achievementService.migrateLegacyAchievements(workspaceId, className);
  clearAllCached();
  return result;
}
