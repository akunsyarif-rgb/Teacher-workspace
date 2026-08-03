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
