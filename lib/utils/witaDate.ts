// Satu-satunya sumber kebenaran "tanggal/hari/jam sekarang" untuk seluruh
// aplikasi. Sebelumnya tiap service memanggil
// `new Date().toISOString().split('T')[0]` sendiri-sendiri — itu tanggal
// UTC, bukan tanggal dinding guru. Untuk WITA (UTC+8) tiap kejadian antara
// 00.00–08.00 tercatat memakai tanggal HARI SEBELUMNYA, padahal nama hari
// diambil dari `getDay()` perangkat yang sudah menunjuk hari baru. Jam
// mengajar pagi jatuh persis di jendela itu: jurnal/presensi yang disimpan
// pukul 07.00 tersimpan bertanggal kemarin, sehingga sesi hari ini
// dianggap belum diisi dan rekap harian meleset satu hari.
//
// Zona waktu dipatok ke WITA (bukan zona perangkat) supaya hasilnya sama
// untuk guru yang perangkatnya salah setel atau sedang di luar zona, dan
// supaya sama antara render di server dan di browser.

export const APP_TIME_ZONE = 'Asia/Makassar';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;

// en-CA memberi format YYYY-MM-DD apa adanya, jadi tidak perlu menyusun
// ulang bagian tanggal secara manual.
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Tanggal kalender WITA dalam format YYYY-MM-DD. */
export function getWitaDateString(date: Date = new Date()): string {
  return dateFormatter.format(date);
}

function getWitaParts(date: Date) {
  const parts = partsFormatter.formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: lookup('weekday'),
    // Beberapa runtime memakai "24" untuk tengah malam pada hour12:false —
    // dinormalkan ke 0 supaya perhitungan menit tidak melompat sehari.
    hour: parseInt(lookup('hour'), 10) % 24,
    minute: parseInt(lookup('minute'), 10),
  };
}

/** Nama hari dalam bahasa Indonesia menurut kalender WITA. */
export function getWitaDayName(date: Date = new Date()): string {
  return DAY_NAMES[WEEKDAY_INDEX[getWitaParts(date).weekday] ?? 0];
}

/** Menit sejak 00.00 menurut jam dinding WITA — dasar status sesi jadwal. */
export function getWitaMinutesOfDay(date: Date = new Date()): number {
  const { hour, minute } = getWitaParts(date);
  return hour * 60 + minute;
}

/**
 * Geser tanggal WITA sejumlah hari kalender. Bekerja pada string tanggal
 * (bukan Date) supaya penggeseran tidak pernah tergelincir karena zona
 * waktu perangkat — "3 hari sebelum 2026-08-11" selalu 2026-08-08.
 */
export function shiftWitaDateString(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().split('T')[0];
}

/** Tanggal WITA `days` hari yang lalu, format YYYY-MM-DD. */
export function getWitaDaysAgo(days: number, date: Date = new Date()): string {
  return shiftWitaDateString(getWitaDateString(date), -days);
}

/** Geser tanggal WITA sejumlah bulan kalender, format YYYY-MM-DD. */
export function shiftWitaMonths(dateStr: string, deltaMonths: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + deltaMonths, day));
  return shifted.toISOString().split('T')[0];
}

/** Nama hari Indonesia untuk sebuah string tanggal YYYY-MM-DD. */
export function getDayNameFromDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}
