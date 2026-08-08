import * as analyticsRepository from '../repositories/analyticsRepository';
import {
  getAllStudentsForSummary,
  getJournalsInRange,
  getAttendancesInRange,
} from '../repositories/dashboardRepository';
import { buildInsights, ANALYSIS_WINDOW_DAYS } from '../utils/insights';

// Logika penarikan kesimpulannya ada di lib/utils/insights.ts — murni,
// tanpa sentuhan Firestore, supaya bisa diuji apa adanya (lihat
// tests/analytics.test.ts). Berkas ini hanya mengurus pengambilan data.
export { ANALYSIS_WINDOW_DAYS, THRESHOLDS, buildInsights } from '../utils/insights';
export type { Insight } from '../utils/insights';

function daysAgoISO(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export async function loadInsights(workspaceId: string) {
  if (!workspaceId) return { insights: [], windowDays: ANALYSIS_WINDOW_DAYS };

  const startDate = daysAgoISO(ANALYSIS_WINDOW_DAYS - 1);
  const endDate = todayISO();

  const [students, attendances, journals, assignments, submissions] = await Promise.all([
    getAllStudentsForSummary(workspaceId),
    getAttendancesInRange(workspaceId, startDate, endDate),
    getJournalsInRange(workspaceId, startDate, endDate),
    analyticsRepository.getAssignmentsInWorkspace(workspaceId),
    analyticsRepository.getSubmissionsInWorkspace(workspaceId),
  ]);

  return {
    insights: buildInsights({ students, attendances, journals, assignments, submissions, today: endDate }),
    windowDays: ANALYSIS_WINDOW_DAYS,
  };
}
