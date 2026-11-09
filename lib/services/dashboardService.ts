import {
  getAllStudentsForSummary,
  getAllSchedulesForSummary,
  getJournalCount,
  getJournalsOnDate,
  getAttendancesOnDate,
  getJournalCountOnDate,
  getAttendanceCountOnDate,
} from '../repositories/dashboardRepository';
import type { Doc } from '../adapters/firestoreAdapter';
import type { ScheduleData } from '../types/models';
import { measure } from '../utils/perf';
import { withPersistentCache } from '../utils/persistentCache';
import { getByDate as getSkipReasonsByDate } from '../repositories/sessionSkipReasonRepository';
import { sortSchedulesChronologically, classifySessionState, SessionState } from '../utils/scheduleTime';
import {
  getWitaDateString,
  getWitaDayName,
  getDayNameFromDateString,
  shiftWitaDateString,
} from '../utils/witaDate';

export type TodayClassStatus = {
  scheduleId: string;
  className: string;
  subject: string;
  timeSlot: string;
  hasJournal: boolean;
  hasAttendance: boolean;
  isDone: boolean;
  // true kalau guru sudah mencatat SkipReason (Rapat/Tugas dinas/Kegiatan
  // sekolah/Lainnya) untuk sesi ini DAN belum ada presensi/jurnal sungguhan
  // (kalau isDone true, data sungguhan menang — lihat classifySessionState).
  // Sesi dengan isSkipped=true dianggap "Tidak Mengajar": TIDAK dihitung
  // sebagai pekerjaan belum selesai (pendingClasses/todayProgress) maupun
  // ditawarkan sebagai Sesi Berikutnya (resolveCurrentWorkflowStep), tapi
  // tetap tercatat (skipReason di bawah, disimpan permanen di Firestore).
  isSkipped: boolean;
  // "Penyesuaian Workflow Jadwal — Final": status otomatis dari jadwal +
  // waktu aktual (upcoming/ongoing/needs_confirmation/done/skipped) — dasar
  // badge 🔵/🟢/⚠️/✅/🗓 dan pengelompokan daftar di Beranda.
  sessionState: SessionState;
  // Alasan yang guru catat kalau sesi ini "needs_confirmation" (Rapat, dst)
  // — null kalau belum dikonfirmasi. Begitu tercatat DAN sesi belum lengkap
  // (isDone false), sesi ini resmi jadi "Tidak Mengajar" (lihat isSkipped
  // di atas) — bukan lagi sekadar konteks tambahan seperti sebelumnya.
  skipReason: { reason: string; note: string } | null;
};

export type DashboardSummary = {
  uniqueClasses: string[];
  totalJournals: number;
  todaySchedules: Doc<ScheduleData>[];
  currentDayName: string;
  todayProgress: {
    total: number;
    journalsDone: number;
    attendancesDone: number;
    percentage: number;
  };
  weeklyStats: {
    days: string[];
    journalCounts: number[];
    attendanceCounts: number[];
  };
  pendingClasses: string[]; // Kelas yang butuh jurnal/presensi hari ini
  todayClassStatuses: TodayClassStatus[]; // Status per slot jadwal hari ini — dasar Action Center
};

export function getCurrentDayName(date: Date = new Date()) {
  return getWitaDayName(date);
}

function getTodayDate(): string {
  return getWitaDateString();
}

// Data yang jarang berubah (daftar siswa/jadwal, angka hari lampau) disimpan di perangkat sebentar supaya
// reload/berpindah menu tidak mengunduh ulang; dibuang otomatis oleh clearAllCached() saat guru mengubah data.
export const DASHBOARD_STATIC_TTL_MS = 10 * 60_000;

export async function loadDashboardSummary(workspaceId: string): Promise<DashboardSummary> {
  if (!workspaceId) {
    return {
      uniqueClasses: [],
      totalJournals: 0,
      todaySchedules: [],
      currentDayName: getCurrentDayName(),
      todayProgress: { total: 0, journalsDone: 0, attendancesDone: 0, percentage: 0 },
      weeklyStats: { days: [], journalCounts: [], attendanceCounts: [] },
      pendingClasses: [],
      todayClassStatuses: [],
    };
  }

  const currentDayName = getCurrentDayName();
  const todayDate = getTodayDate();
  
  const pastDates = Array.from({ length: 6 }, (_, k) => shiftWitaDateString(todayDate, -(6 - k)));
  const ttl = DASHBOARD_STATIC_TTL_MS;
  const ws = workspaceId;

  const [uniqueClasses, journalsToday, schedules, attendancesToday, totalJournalsCount, skipReasonsToday, pastCounts] =
    await Promise.all([
      measure('ringkasan: siswa', () =>
        withPersistentCache(`dash:classes:${ws}`, ttl, async () =>
          Array.from(
            new Set((await getAllStudentsForSummary(ws)).map((s) => s.className?.trim()).filter(Boolean))
          ) as string[]
        )
      ),
      measure('ringkasan: jurnal hari ini', () => getJournalsOnDate(ws, todayDate)),
      measure('ringkasan: jadwal', () =>
        withPersistentCache(`dash:schedules:${ws}`, ttl, () => getAllSchedulesForSummary(ws))
      ),
      measure('ringkasan: presensi hari ini', () => getAttendancesOnDate(ws, todayDate)),
      measure('ringkasan: hitung jurnal', () => getJournalCount(ws)),
      measure('ringkasan: alasan skip', () => getSkipReasonsByDate(ws, todayDate)),
      measure('ringkasan: angka 6 hari lalu', () =>
        withPersistentCache(`dash:past:${ws}:${todayDate}`, ttl, async () => {
          const [j, a] = await Promise.all([
            Promise.all(pastDates.map((d) => getJournalCountOnDate(ws, d))),
            Promise.all(pastDates.map((d) => getAttendanceCountOnDate(ws, d))),
          ]);
          return { j, a };
        })
      ),
    ]);

  // Jadwal hari ini, diurutkan berdasarkan jam mulai
  const todaySchedules = sortSchedulesChronologically(
    schedules.filter((s) => String(s.day ?? '').toLowerCase() === currentDayName.toLowerCase())
  );

  // Status per slot jadwal (bukan per nama kelas) — supaya kelas dengan dua
  // slot jadwal berbeda di hari yang sama tidak saling tertukar status
  // selesainya. Record baru dicocokkan lewat scheduleId; record lama tanpa
  // scheduleId jatuh ke pencocokan className seperti sebelumnya.
  const todayClassStatuses: TodayClassStatus[] = todaySchedules.map((s) => {
    const hasJournal = journalsToday.some((j) =>
      j.scheduleId ? j.scheduleId === s.id : j.className?.trim() === s.className?.trim()
    );
    const hasAttendance = attendancesToday.some((a) =>
      a.scheduleId ? a.scheduleId === s.id : a.className?.trim() === s.className?.trim()
    );
    const isDone = hasJournal && hasAttendance;
    const skip = skipReasonsToday.find((r) => r.scheduleId === s.id);
    const isSkipped = !!skip && !isDone;
    return {
      scheduleId: s.id,
      className: s.className,
      subject: s.subject,
      timeSlot: s.timeSlot,
      hasJournal,
      hasAttendance,
      isDone,
      isSkipped,
      sessionState: classifySessionState(s.timeSlot || '', isDone, undefined, isSkipped),
      skipReason: skip ? { reason: skip.reason ?? '', note: skip.note || '' } : null,
    };
  });

  // Sesi "Tidak Mengajar" (isSkipped) dikeluarkan dari penghitungan progres
  // hari ini — statusnya sudah final dan tidak berlaku untuk presensi/
  // jurnal, jadi tidak boleh membuat persentase hari itu tersendat di bawah
  // 100% atau tetap nyangkut di daftar pekerjaan belum selesai.
  const countableStatuses = todayClassStatuses.filter((s) => !s.isSkipped);
  const journalsDone = countableStatuses.filter((s) => s.hasJournal).length;
  const attendancesDone = countableStatuses.filter((s) => s.hasAttendance).length;
  const total = countableStatuses.length;
  const percentage = total > 0 ? Math.round(((journalsDone + attendancesDone) / (total * 2)) * 100) : 0;
  const pendingClasses = Array.from(
    new Set(countableStatuses.filter((s) => !s.isDone).map((s) => s.className))
  );

  // ===== STATISTIK MINGGUAN (7 hari terakhir) =====
  const weeklyDays: string[] = [];
  const weeklyJournalCounts: number[] = [];
  const weeklyAttendanceCounts: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const dateStr = shiftWitaDateString(todayDate, -i);
    const dayName = getDayNameFromDateString(dateStr);

    // Jumlah jurnal pada hari itu
    const journalCount = i === 0 ? journalsToday.length : pastCounts.j[6 - i] ?? 0;
    const attendanceCount = i === 0 ? attendancesToday.length : pastCounts.a[6 - i] ?? 0;

    weeklyDays.push(dayName.substring(0, 3)); // Sen, Sel, Rab, ...
    weeklyJournalCounts.push(journalCount);
    weeklyAttendanceCounts.push(attendanceCount);
  }

  return {
    uniqueClasses,
    totalJournals: totalJournalsCount,
    todaySchedules,
    currentDayName,
    todayProgress: {
      total,
      journalsDone,
      attendancesDone,
      percentage,
    },
    todayClassStatuses,
    weeklyStats: {
      days: weeklyDays,
      journalCounts: weeklyJournalCounts,
      attendanceCounts: weeklyAttendanceCounts,
    },
    pendingClasses,
  };
}
