import * as analyticsService from '../services/analyticsService';
import { withCache } from '../utils/sessionCache';

export async function fetchInsights(workspaceId: string) {
  if (!workspaceId) return { insights: [], windowDays: analyticsService.ANALYSIS_WINDOW_DAYS };
  return withCache(`insights:${workspaceId}`, () => analyticsService.loadInsights(workspaceId));
}
