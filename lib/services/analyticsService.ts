import * as analyticsRepository from '../repositories/analyticsRepository';
import {
  getJournalsInRange,
  getAttendancesInRange,
} from '../repositories/dashboardRepository';
import { listClassSummaries } from './studentService';
import { loadTeacherClasses, type TeacherClasses } from './teacherScopeService';
import { classSignature, type TeacherScope } from '../utils/teacherScope';
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

// Cakupan: OWNER/ADMIN melihat seluruh workspace (pengawasan); guru biasa hanya kelas miliknya (jadwal miliknya +
// kelas wali; data lama tanpa createdBy dianggap milik semua — lihat lib/utils/teacherScope.ts). Guru tanpa kelas
// mendapat hasil kosong (tanpa membaca apa pun).
export async function loadInsights(workspaceId: string, teacher: TeacherScope) {
  const empty = { insights: [], windowDays: ANALYSIS_WINDOW_DAYS };
  if (!workspaceId || !teacher?.uid) return empty;
  const wide = teacher.role === 'OWNER' || teacher.role === 'ADMIN';
  const scope = wide ? null : await loadTeacherClasses(workspaceId, teacher);
  if (scope && scope.variants.length === 0) return empty;
  const sig = scope ? `${teacher.uid}:${classSignature(scope.classes)}` : 'all';
  return withPersistentCache(`insights:${workspaceId}:${sig}:${todayISO()}`, INSIGHTS_TTL_MS, () =>
    computeInsights(workspaceId, sig, scope)
  );
}

async function computeInsights(workspaceId: string, sig: string, scope: TeacherClasses | null) {
  const endDate = todayISO();
  const windowStart = daysAgoISO(ANALYSIS_WINDOW_DAYS - 1);
  const variants = scope?.variants;

  // Presensi + jurnal 30 hari: hanya hari-hari terbaru yang diunduh (sisanya dari rekap di perangkat).
  const key = `insights-days:${workspaceId}:${sig}`;
  const state = syncStore.get<InsightSyncState>(key);
  const plan = planInsightSync(state, endDate, windowStart, shiftWitaDateString);
  const from = plan.kind === 'full' ? windowStart : plan.from;
  const full = plan.kind === 'full';

  // Tugas yang tenggatnya jatuh di jendela analisis (bukan seluruh riwayat); jumlah pengumpulan lewat count.
  const [classSummaries, attendances, journals, allAssignments] = await Promise.all([
    listClassSummaries(workspaceId), // jumlah siswa aktif per kelas (cache perangkat 10 menit)
    getAttendancesInRange(workspaceId, from, endDate, variants),
    getJournalsInRange(workspaceId, from, endDate, variants),
    analyticsRepository.getAssignmentsDueInRange(workspaceId, windowStart, endDate),
  ]);
  const mine = scope ? new Set(scope.classes) : null;
  const assignments = mine ? allAssignments.filter((a) => mine.has(a.className?.trim())) : allAssignments;
  const submissionCount = await analyticsRepository.getSubmissionCountsForAssignments(
    workspaceId,
    assignments.map((a) => a.id)
  );

  const next = applyInsightFetch(state, from, windowStart, endDate, rollupDays(attendances, journals), full);
  syncStore.set(key, next);
  const { perStudent, missingJournals } = mergeDays(next.days);

  const studentsPerClass: Record<string, number> = {};
  classSummaries.forEach((c) => {
    if (!mine || mine.has(c.className)) studentsPerClass[c.className] = c.count;
  });

  return {
    insights: buildInsightsFromAggregates({ perStudent, missingJournals, studentsPerClass, submissionCount, assignments, today: endDate }),
    windowDays: ANALYSIS_WINDOW_DAYS,
  };
}
