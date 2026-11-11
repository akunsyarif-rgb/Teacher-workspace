import * as analyticsRepository from '../repositories/analyticsRepository';
import {
  getJournalsInRange,
  getAttendancesInRange,
} from '../repositories/dashboardRepository';
import { listClassSummaries } from './studentService';
import { syncStore, withPersistentCache } from '../utils/persistentCache';
import { buildInsightsFromAggregates, ANALYSIS_WINDOW_DAYS } from '../utils/insights';
import { planInsightSync, applyInsightFetch, rollupDays, mergeDays, type InsightSyncState } from '../utils/insightSync';
import { getWitaDateString, getWitaDaysAgo, shiftWitaDateString } from '../utils/witaDate';

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
  const endDate = todayISO();
  const windowStart = daysAgoISO(ANALYSIS_WINDOW_DAYS - 1);

  // Presensi + jurnal 30 hari: hanya hari-hari terbaru yang diunduh (sisanya dari rekap di perangkat).
  const key = `insights-days:${workspaceId}`;
  const state = syncStore.get<InsightSyncState>(key);
  const plan = planInsightSync(state, endDate, windowStart, shiftWitaDateString);
  const from = plan.kind === 'full' ? windowStart : plan.from;
  const full = plan.kind === 'full';

  // Tugas yang tenggatnya jatuh di jendela analisis (bukan seluruh riwayat); jumlah pengumpulan lewat count.
  const [classSummaries, attendances, journals, assignments] = await Promise.all([
    listClassSummaries(workspaceId), // jumlah siswa aktif per kelas (cache perangkat 10 menit)
    getAttendancesInRange(workspaceId, from, endDate),
    getJournalsInRange(workspaceId, from, endDate),
    analyticsRepository.getAssignmentsDueInRange(workspaceId, windowStart, endDate),
  ]);
  const submissionCount = await analyticsRepository.getSubmissionCountsForAssignments(
    workspaceId,
    assignments.map((a) => a.id)
  );

  const next = applyInsightFetch(state, from, windowStart, endDate, rollupDays(attendances, journals), full);
  syncStore.set(key, next);
  const { perStudent, missingJournals } = mergeDays(next.days);

  const studentsPerClass: Record<string, number> = {};
  classSummaries.forEach((c) => (studentsPerClass[c.className] = c.count));

  return {
    insights: buildInsightsFromAggregates({ perStudent, missingJournals, studentsPerClass, submissionCount, assignments, today: endDate }),
    windowDays: ANALYSIS_WINDOW_DAYS,
  };
}
