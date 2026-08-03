import { loadDashboardSummary } from '../services/dashboardService';
import { withCache } from '../utils/sessionCache';

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
      todayClassStatuses: [],
    };
  }
  // TTL pendek (bukan default 60s) — ringkasan ini dipakai Action
  // Center/Workflow Engine yang perlu terasa akurat begitu guru berpindah
  // menu, walau tanpa aksi simpan yang men-trigger clearAllCached().
  return withCache(`dashboardSummary:${workspaceId}`, () => loadDashboardSummary(workspaceId), 15_000);
}
