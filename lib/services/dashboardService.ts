import {
  getAllStudentsForSummary,
  getJournalsInRange,
  getAllSchedulesForSummary,
  getAttendancesInRange,
  getJournalCount,
} from '../repositories/dashboardRepository';
import { getByDate as getSkipReasonsByDate } from '../repositories/sessionSkipReasonRepository';
import { getScheduleStartMinutes, classifySessionState, SessionState } from '../utils/scheduleTime';

export type TodayClassStatus = {
  scheduleId: string;
  className: string;
  subject: string;
  timeSlot: string;
  hasJournal: boolean;
  hasAttendance: boolean;
  isDone: boolean;
  // "Penyesuaian Workflow Jadwal — Final": status otomatis dari jadwal +
  // waktu aktual (upcoming/ongoing/needs_confirmation/done) — dasar badge
  // 🔵/🟢/⚠️/✅ dan pengelompokan daftar di Beranda.
  sessionState: SessionState;
  // Alasan yang guru catat kalau sesi ini "needs_confirmation" (Rapat, dst)
  // — null kalau belum dikonfirmasi. TIDAK mengubah isDone/sessionState;
  // murni konteks tambahan (lihat sessionSkipReasonService).
  skipReason: { reason: string; note: string } | null;
};

export type DashboardSummary = {
  uniqueClasses: string[];
  totalJournals: number;
  todaySchedules: any[];
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

const DAY_NAMES: Record<number, string> = {
  0: 'Minggu',
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: 'Jumat',
  6: 'Sabtu',
};

export function getCurrentDayName(date: Date = new Date()) {
  return DAY_NAMES[date.getDay()];
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return getDateString(date);
}

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
  const sevenDaysAgo = getDaysAgo(6); // 6 hari lalu s/d hari ini = 7 hari

  const [students, journals, schedules, attendances, totalJournalsCount, skipReasonsToday] = await Promise.all([
    getAllStudentsForSummary(workspaceId),
    getJournalsInRange(workspaceId, sevenDaysAgo, todayDate),
    getAllSchedulesForSummary(workspaceId),
    getAttendancesInRange(workspaceId, sevenDaysAgo, todayDate),
    getJournalCount(workspaceId),
    getSkipReasonsByDate(workspaceId, todayDate),
  ]);

  const uniqueClasses = Array.from(
    new Set(students.map((s: any) => s.className?.trim()).filter(Boolean))
  ) as string[];

  // Jadwal hari ini, diurutkan berdasarkan jam mulai
  const todaySchedules = schedules
    .filter((s: any) => String(s.day ?? '').toLowerCase() === currentDayName.toLowerCase())
    .sort((a: any, b: any) => getScheduleStartMinutes(a.timeSlot || '') - getScheduleStartMinutes(b.timeSlot || ''));

  const journalsToday = journals.filter((j: any) => j.date === todayDate);
  const attendancesToday = attendances.filter((a: any) => a.date === todayDate);

  // Status per slot jadwal (bukan per nama kelas) — supaya kelas dengan dua
  // slot jadwal berbeda di hari yang sama tidak saling tertukar status
  // selesainya. Record baru dicocokkan lewat scheduleId; record lama tanpa
  // scheduleId jatuh ke pencocokan className seperti sebelumnya.
  const todayClassStatuses: TodayClassStatus[] = todaySchedules.map((s: any) => {
    const hasJournal = journalsToday.some((j: any) =>
      j.scheduleId ? j.scheduleId === s.id : j.className?.trim() === s.className?.trim()
    );
    const hasAttendance = attendancesToday.some((a: any) =>
      a.scheduleId ? a.scheduleId === s.id : a.className?.trim() === s.className?.trim()
    );
    const isDone = hasJournal && hasAttendance;
    const skip = (skipReasonsToday as any[]).find((r) => r.scheduleId === s.id);
    return {
      scheduleId: s.id,
      className: s.className,
      subject: s.subject,
      timeSlot: s.timeSlot,
      hasJournal,
      hasAttendance,
      isDone,
      sessionState: classifySessionState(s.timeSlot || '', isDone),
      skipReason: skip ? { reason: skip.reason, note: skip.note || '' } : null,
    };
  });

  const journalsDone = todayClassStatuses.filter((s) => s.hasJournal).length;
  const attendancesDone = todayClassStatuses.filter((s) => s.hasAttendance).length;
  const total = todayClassStatuses.length;
  const percentage = total > 0 ? Math.round(((journalsDone + attendancesDone) / (total * 2)) * 100) : 0;
  const pendingClasses = Array.from(
    new Set(todayClassStatuses.filter((s) => !s.isDone).map((s) => s.className))
  );

  // ===== STATISTIK MINGGUAN (7 hari terakhir) =====
  const weeklyDays: string[] = [];
  const weeklyJournalCounts: number[] = [];
  const weeklyAttendanceCounts: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = getDateString(date);
    const dayName = DAY_NAMES[date.getDay()];

    // Jumlah jurnal pada hari itu
    const journalCount = journals.filter((j: any) => j.date === dateStr).length;
    const attendanceCount = attendances.filter((a: any) => a.date === dateStr).length;

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
