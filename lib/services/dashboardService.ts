import {
  getAllStudentsForSummary,
  getAllJournalsForSummary,
  getAllSchedulesForSummary,
  getAllAttendancesForSummary,
} from '../repositories/dashboardRepository';

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
  pendingClasses: string[]; // Kelas yang butuh jurnal hari ini
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
    };
  }

  const [students, journals, schedules, attendances] = await Promise.all([
    getAllStudentsForSummary(workspaceId),
    getAllJournalsForSummary(workspaceId),
    getAllSchedulesForSummary(workspaceId),
    getAllAttendancesForSummary(workspaceId),
  ]);

  const uniqueClasses = Array.from(
    new Set(students.map((s: any) => s.className?.trim()).filter(Boolean))
  ) as string[];

  const currentDayName = getCurrentDayName();
  const todayDate = getTodayDate();

  // Jadwal hari ini
  const todaySchedules = schedules.filter(
    (s: any) => String(s.day ?? '').toLowerCase() === currentDayName.toLowerCase()
  );

  // Hitung progress administrasi
  const todayClassNames = Array.from(
    new Set(todaySchedules.map((s: any) => s.className?.trim()).filter(Boolean))
  ) as string[];

  const journalsToday = journals.filter((j: any) => j.date === todayDate);
  const journalClasses = new Set(journalsToday.map((j: any) => j.className?.trim()).filter(Boolean));

  const attendancesToday = attendances.filter((a: any) => a.date === todayDate);
  const attendanceClasses = new Set(attendancesToday.map((a: any) => a.className?.trim()).filter(Boolean));

  let journalsDone = 0;
  let attendancesDone = 0;
  const pendingClasses: string[] = [];

  todayClassNames.forEach((cls) => {
    const hasJournal = journalClasses.has(cls);
    const hasAttendance = attendanceClasses.has(cls);
    if (hasJournal) journalsDone += 1;
    if (hasAttendance) attendancesDone += 1;
    if (!hasJournal || !hasAttendance) {
      pendingClasses.push(cls);
    }
  });

  const total = todayClassNames.length;
  const percentage = total > 0 ? Math.round(((journalsDone + attendancesDone) / (total * 2)) * 100) : 0;

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
    totalJournals: journals.length,
    todaySchedules,
    currentDayName,
    todayProgress: {
      total,
      journalsDone,
      attendancesDone,
      percentage,
    },
    weeklyStats: {
      days: weeklyDays,
      journalCounts: weeklyJournalCounts,
      attendanceCounts: weeklyAttendanceCounts,
    },
    pendingClasses,
  };
}
