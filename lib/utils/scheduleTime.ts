export type ScheduleLike = {
  id: string;
  className: string;
  day: string;
  timeSlot: string;
};

export function isScheduleOngoing(timeSlot: string, now: Date = new Date()): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const timeRangeRegex = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;
  const match = timeSlot.match(timeRangeRegex);
  if (match) {
    const startHour = parseInt(match[1], 10);
    const startMin = parseInt(match[2], 10);
    const endHour = parseInt(match[3], 10);
    const endMin = parseInt(match[4], 10);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  const jamKeRegex = /Jam Ke[- ](\d+)\s*s\.d\.\s*(\d+)/i;
  const jamMatch = timeSlot.match(jamKeRegex);
  if (jamMatch) {
    const startKe = parseInt(jamMatch[1], 10);
    const endKe = parseInt(jamMatch[2], 10);
    const baseMinutes = 7 * 60 + 30;
    const startMinutes = baseMinutes + (startKe - 1) * 45;
    const endMinutes = baseMinutes + endKe * 45;
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return false;
}

/**
 * Menit-ke-berapa (sejak 00.00) sebuah slot jadwal dimulai — dipakai untuk
 * mengurutkan daftar jadwal/Action Center secara kronologis. Format yang
 * tidak dikenali ditaruh paling akhir daripada dianggap error.
 */
export function getScheduleStartMinutes(timeSlot: string): number {
  const timeRangeRegex = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;
  const match = timeSlot.match(timeRangeRegex);
  if (match) {
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  const jamKeRegex = /Jam Ke[- ](\d+)\s*s\.d\.\s*(\d+)/i;
  const jamMatch = timeSlot.match(jamKeRegex);
  if (jamMatch) {
    const startKe = parseInt(jamMatch[1], 10);
    const baseMinutes = 7 * 60 + 30;
    return baseMinutes + (startKe - 1) * 45;
  }

  return Number.MAX_SAFE_INTEGER;
}

/**
 * Cari schedule occurrence yang relevan untuk kelas ini hari ini — dipakai
 * untuk menandai jurnal/presensi dengan scheduleId saat dibuat, supaya
 * kelas dengan lebih dari satu slot jadwal di hari yang sama tidak
 * tertukar statusnya (lihat dashboardService).
 */
export function findActiveScheduleId(
  schedules: ScheduleLike[],
  className: string,
  dayName: string
): string | null {
  const todays = schedules.filter(
    (s) => s.className === className && String(s.day ?? '').toLowerCase() === dayName.toLowerCase()
  );
  if (todays.length === 0) return null;
  const ongoing = todays.find((s) => isScheduleOngoing(s.timeSlot));
  return (ongoing ?? todays[0]).id;
}

export type WorkflowStep<T extends { timeSlot: string; isDone: boolean }> = {
  status: T;
  isOngoing: boolean;
};

/**
 * Lapisan orkestrasi (Workflow Engine): dari daftar status kelas hari ini
 * (sudah terurut kronologis, lihat dashboardService), tentukan SATU sesi
 * yang paling relevan untuk guru sekarang — supaya guru tidak perlu
 * menyusuri daftar sendiri. Prioritas: sesi yang sedang berlangsung dan
 * belum selesai, lalu sesi belum selesai berikutnya. null kalau semua
 * sudah selesai atau tidak ada jadwal hari ini.
 */
export function resolveCurrentWorkflowStep<T extends { timeSlot: string; isDone: boolean }>(
  statuses: T[],
  now: Date = new Date()
): WorkflowStep<T> | null {
  const pending = statuses.filter((s) => !s.isDone);
  if (pending.length === 0) return null;

  const ongoing = pending.find((s) => isScheduleOngoing(s.timeSlot, now));
  if (ongoing) return { status: ongoing, isOngoing: true };

  return { status: pending[0], isOngoing: false };
}
