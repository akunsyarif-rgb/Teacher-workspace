import { loadDashboardSummary } from '../services/dashboardService';

export async function fetchDashboardSummary(workspaceId: string) {
  if (!workspaceId) {
    return {
      uniqueClasses: [],
      totalJournals: 0,
      todaySchedules: [],
      currentDayName: '',
      todayProgress: { total: 0, journalsDone: 0, attendancesDone: 0, percentage: 0 },
      weeklyStats: { days: [], journalCounts: [], attendanceCounts: [] },
      pendingClasses: [],
    };
  }
  return loadDashboardSummary(workspaceId);
}
