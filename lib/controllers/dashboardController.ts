import { loadDashboardSummary } from '../services/dashboardService';
import { withCache } from '../utils/sessionCache';
import type { TeacherScope } from '../utils/teacherScope';

// TTL pendek (bukan default 60s) — dipakai juga oleh pemanggil yang perlu
// mengecek "apakah cache-nya masih hangat" (mis. AttendanceForm sebelum
// menyalakan loading) supaya patokannya konsisten dengan withCache di bawah.
export const DASHBOARD_SUMMARY_TTL_MS = 15_000;

export function dashboardSummaryCacheKey(workspaceId: string, uid: string) {
  return `dashboardSummary:${workspaceId}:${uid}`;
}

// Beranda per guru: `teacher` (uid/role/kelas wali) menentukan jadwal & kelas yang dihitung.
export async function fetchDashboardSummary(workspaceId: string, teacher: TeacherScope) {
  if (!workspaceId || !teacher?.uid) {
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
  // TTL pendek — ringkasan ini dipakai Action Center/Workflow Engine yang
  // perlu terasa akurat begitu guru berpindah menu, walau tanpa aksi
  // simpan yang men-trigger clearAllCached().
  return withCache(dashboardSummaryCacheKey(workspaceId, teacher.uid), () => loadDashboardSummary(workspaceId, teacher), DASHBOARD_SUMMARY_TTL_MS);
}
