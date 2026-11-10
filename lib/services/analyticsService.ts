import * as analyticsRepository from '../repositories/analyticsRepository';
import {
  getAllStudentsForSummary,
  getJournalsInRange,
  getAttendancesInRange,
} from '../repositories/dashboardRepository';
import { withPersistentCache } from '../utils/persistentCache';
import { buildInsights, ANALYSIS_WINDOW_DAYS } from '../utils/insights';
import { getWitaDateString, getWitaDaysAgo } from '../utils/witaDate';

// Logika penarikan kesimpulannya ada di lib/utils/insights.ts — murni,
// tanpa sentuhan Firestore, supaya bisa diuji apa adanya (lihat
// tests/analytics.test.ts). Berkas ini hanya mengurus pengambilan data.
export { ANALYSIS_WINDOW_DAYS, THRESHOLDS, buildInsights } from '../utils/insights';
export type { Insight } from '../utils/insights';

function daysAgoISO(days: number) {
  return getWitaDaysAgo(days);
}

function todayISO() {
  return getWitaDateString();
}

// Temuan analitik berasal dari ±10 ribu dokumen (jendela 30 hari seluruh workspace) tetapi hasilnya kecil, jadi
// hasil jadinya disimpan di perangkat (TTL 30 menit, kunci per tanggal; dibuang oleh clearAllCached() saat guru
// menyimpan perubahan di perangkat ini). Insight 30 hari tidak butuh ketepatan menit-per-menit.
export const INSIGHTS_TTL_MS = 30 * 60_000;

export async function loadInsights(workspaceId: string) {
  if (!workspaceId) return { insights: [], windowDays: ANALYSIS_WINDOW_DAYS };
  return withPersistentCache(`insights:${workspaceId}:${todayISO()}`, INSIGHTS_TTL_MS, () => computeInsights(workspaceId));
}

async function computeInsights(workspaceId: string) {

  const startDate = daysAgoISO(ANALYSIS_WINDOW_DAYS - 1);
  const endDate = todayISO();

  // Tugas yang tenggatnya jatuh di jendela analisis (bukan seluruh riwayat), lalu hanya
  // pengumpulan milik tugas-tugas itu.
  const [students, attendances, journals, assignments] = await Promise.all([
    getAllStudentsForSummary(workspaceId),
    getAttendancesInRange(workspaceId, startDate, endDate),
    getJournalsInRange(workspaceId, startDate, endDate),
    analyticsRepository.getAssignmentsDueInRange(workspaceId, startDate, endDate),
  ]);
  const submissions = await analyticsRepository.getSubmissionsForAssignments(
    workspaceId,
    assignments.map((a) => a.id)
  );

  return {
    insights: buildInsights({ students, attendances, journals, assignments, submissions, today: endDate }),
    windowDays: ANALYSIS_WINDOW_DAYS,
  };
}
