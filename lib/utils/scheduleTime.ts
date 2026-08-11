export type ScheduleLike = {
  id: string;
  className: string;
  day: string;
  timeSlot: string;
};

const TIME_RANGE_REGEX = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;
const JAM_KE_REGEX = /Jam Ke[- ](\d+)\s*s\.d\.\s*(\d+)/i;
const JAM_KE_BASE_MINUTES = 7 * 60 + 30;
const JAM_KE_DURATION_MINUTES = 45;

/**
 * Satu-satunya tempat yang mem-parsing format `timeSlot` (baik "07:00-08:30"
 * maupun "Jam Ke-1 s.d. 2") jadi rentang menit sejak 00.00 — sebelumnya
 * regex yang sama diduplikasi terpisah di isScheduleOngoing dan
 * getScheduleStartMinutes, gampang berubah tidak konsisten. Format yang
 * tidak dikenali mengembalikan null, bukan error, supaya pemanggil bisa
 * memilih fallback-nya sendiri.
 */
function parseScheduleRange(timeSlot: string): { startMinutes: number; endMinutes: number } | null {
  const rangeMatch = timeSlot.match(TIME_RANGE_REGEX);
  if (rangeMatch) {
    const startMinutes = parseInt(rangeMatch[1], 10) * 60 + parseInt(rangeMatch[2], 10);
    const endMinutes = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10);
    return { startMinutes, endMinutes };
  }

  const jamKeMatch = timeSlot.match(JAM_KE_REGEX);
  if (jamKeMatch) {
    const startKe = parseInt(jamKeMatch[1], 10);
    const endKe = parseInt(jamKeMatch[2], 10);
    const startMinutes = JAM_KE_BASE_MINUTES + (startKe - 1) * JAM_KE_DURATION_MINUTES;
    const endMinutes = JAM_KE_BASE_MINUTES + endKe * JAM_KE_DURATION_MINUTES;
    return { startMinutes, endMinutes };
  }

  return null;
}

export function isScheduleOngoing(timeSlot: string, now: Date = new Date()): boolean {
  const range = parseScheduleRange(timeSlot);
  if (!range) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= range.startMinutes && currentMinutes <= range.endMinutes;
}

/**
 * Menit-ke-berapa (sejak 00.00) sebuah slot jadwal dimulai — dipakai untuk
 * mengurutkan daftar jadwal/Action Center secara kronologis. Format yang
 * tidak dikenali ditaruh paling akhir daripada dianggap error.
 */
export function getScheduleStartMinutes(timeSlot: string): number {
  return parseScheduleRange(timeSlot)?.startMinutes ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Sudah lewat jam pelajarannya (waktu sekarang > jam selesai slot ini)?
 * Dipakai Beranda untuk memisahkan sesi "done" yang sudah lewat waktu ke
 * "Riwayat Mengajar Hari Ini" dari sesi "done" yang selesai lebih awal
 * (misal presensi+jurnal diisi sebelum jam pelajarannya benar-benar mulai)
 * — yang terakhir ini tetap dianggap bagian dari Sesi Aktif hari ini, bukan
 * riwayat, karena jam pelajarannya sendiri belum berakhir.
 */
export function hasScheduleEnded(timeSlot: string, now: Date = new Date()): boolean {
  const range = parseScheduleRange(timeSlot);
  if (!range) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes > range.endMinutes;
}

export type SessionState = 'upcoming' | 'ongoing' | 'needs_confirmation' | 'done';

/**
 * Status otomatis satu sesi berdasarkan jadwal resmi + waktu aktual, sesuai
 * "Penyesuaian Workflow Jadwal — Final": jadwal = sumber kebenaran, waktu
 * aktual = penentu status, presensi/jurnal = penentu penyelesaian (isDone
 * TIDAK pernah diputuskan di sini, murni diteruskan dari pemanggil).
 * Format timeSlot yang tidak dikenali dianggap "upcoming" — lebih aman
 * daripada menuduh guru belum konfirmasi sesi yang jadwalnya sendiri tidak
 * terbaca.
 */
export function classifySessionState(
  timeSlot: string,
  isDone: boolean,
  now: Date = new Date()
): SessionState {
  if (isDone) return 'done';
  if (isScheduleOngoing(timeSlot, now)) return 'ongoing';

  const range = parseScheduleRange(timeSlot);
  if (!range) return 'upcoming';

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes < range.startMinutes ? 'upcoming' : 'needs_confirmation';
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
 * yang paling relevan untuk guru SEKARANG — supaya guru tidak perlu
 * menyusuri daftar sendiri. Prioritas: sesi yang sedang berlangsung, lalu
 * sesi belum dimulai berikutnya.
 *
 * SENGAJA tidak lagi jatuh balik ke "sesi belum selesai pertama" tanpa
 * peduli waktunya — sesi yang jam pelajarannya sudah lewat tapi belum
 * lengkap adalah "Perlu Konfirmasi" (lihat classifySessionState), bukan
 * "Sesi Berikutnya". Kalau semua sesi yang tersisa hari ini sudah lewat
 * waktunya, kembalikan null — daftar "Perlu Konfirmasi" terpisah (di
 * Beranda) yang menampung sesi-sesi itu, supaya guru tidak diarahkan
 * seolah-olah harus "memulai" sesi yang jadwalnya sudah berakhir.
 */
export function resolveCurrentWorkflowStep<T extends { timeSlot: string; isDone: boolean }>(
  statuses: T[],
  now: Date = new Date()
): WorkflowStep<T> | null {
  const pending = statuses.filter((s) => !s.isDone);
  if (pending.length === 0) return null;

  const ongoing = pending.find((s) => isScheduleOngoing(s.timeSlot, now));
  if (ongoing) return { status: ongoing, isOngoing: true };

  const upcoming = pending.find((s) => classifySessionState(s.timeSlot, s.isDone, now) === 'upcoming');
  if (upcoming) return { status: upcoming, isOngoing: false };

  return null;
}
