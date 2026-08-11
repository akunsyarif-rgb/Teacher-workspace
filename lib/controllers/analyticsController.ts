import * as analyticsService from '../services/analyticsService';
import { withCache } from '../utils/sessionCache';

export function insightsCacheKey(workspaceId: string) {
  return `insights:${workspaceId}`;
}

export async function fetchInsights(workspaceId: string) {
  if (!workspaceId) return { insights: [], windowDays: analyticsService.ANALYSIS_WINDOW_DAYS };
  return withCache(insightsCacheKey(workspaceId), () => analyticsService.loadInsights(workspaceId));
}
