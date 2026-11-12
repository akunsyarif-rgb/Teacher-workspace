import * as analyticsService from '../services/analyticsService';
import { withCache } from '../utils/sessionCache';
import type { TeacherScope } from '../utils/teacherScope';

export function insightsCacheKey(workspaceId: string, uid: string) {
  return `insights:${workspaceId}:${uid}`;
}

export async function fetchInsights(workspaceId: string, teacher: TeacherScope) {
  if (!workspaceId || !teacher?.uid) return { insights: [], windowDays: analyticsService.ANALYSIS_WINDOW_DAYS };
  return withCache(insightsCacheKey(workspaceId, teacher.uid), () => analyticsService.loadInsights(workspaceId, teacher));
}
