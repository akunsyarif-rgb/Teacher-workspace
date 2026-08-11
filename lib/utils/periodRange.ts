import { getWitaDateString, shiftWitaMonths } from './witaDate';
export type PeriodPreset = 'month' | 'two_months' | 'semester' | 'academic_year' | 'custom' | 'all';

export type DateRange = {
  // null = tak terbatas ke arah itu ('all', atau tahun ajaran yang masih
  // aktif dan belum ada endDate-nya).
  startDate: string | null;
  endDate: string | null;
};

function todayDateString(): string {
  return getWitaDateString();
}

function monthsAgo(months: number): string {
  return shiftWitaMonths(todayDateString(), -months);
}

/**
 * "Bulan"/"2 Bulan"/"Semester" dihitung sebagai jendela MUNDUR dari hari
 * ini (bukan batas kalender semester Ganjil/Genap tetap) — sekolah punya
 * kalender akademik yang berbeda-beda, jadi jendela relatif ini benar
 * untuk semua tanpa perlu tahu kalender spesifik sekolahnya. "Tahun
 * Ajaran" TIDAK memakai pendekatan ini — itu memakai rentang
 * startDate..endDate sungguhan dari dokumen academic_years yang dipilih
 * (lihat parameter `academicYear`).
 */
export function resolvePeriodRange(
  preset: PeriodPreset,
  options: {
    academicYear?: { startDate: string; endDate: string | null } | null;
    customStartDate?: string;
    customEndDate?: string;
  } = {}
): DateRange {
  const today = todayDateString();

  switch (preset) {
    case 'month':
      return { startDate: monthsAgo(1), endDate: today };
    case 'two_months':
      return { startDate: monthsAgo(2), endDate: today };
    case 'semester':
      return { startDate: monthsAgo(6), endDate: today };
    case 'academic_year':
      if (!options.academicYear) return { startDate: null, endDate: null };
      return { startDate: options.academicYear.startDate, endDate: options.academicYear.endDate };
    case 'custom':
      if (!options.customStartDate || !options.customEndDate) {
        throw new Error('Rentang tanggal khusus wajib diisi (mulai dan sampai).');
      }
      if (options.customStartDate > options.customEndDate) {
        throw new Error('Tanggal mulai tidak boleh setelah tanggal sampai.');
      }
      return { startDate: options.customStartDate, endDate: options.customEndDate };
    case 'all':
    default:
      return { startDate: null, endDate: null };
  }
}

/**
 * Ubah DateRange jadi filter Firestore [field, op, value][] untuk satu
 * koleksi — dipakai bersama oleh dataArchiveRepository (hitung) dan
 * dataCleanupRepository (hapus) supaya keduanya SELALU mencocokkan
 * dokumen yang PERSIS sama (preview yang ditampilkan ke guru harus sama
 * dengan yang benar-benar terhapus). `dateFormat: 'isoDateTime'` menambah
 * "T23:59:59.999Z" di endDate supaya seluruh hari terakhir ikut ter-cakup
 * (field seperti submittedAt punya komponen waktu, beda dari field
 * "YYYY-MM-DD" polos seperti journals.date).
 */
export function buildDateRangeFilters(
  dateField: string,
  dateFormat: 'dateOnly' | 'isoDateTime',
  range: DateRange
): [string, any, any][] {
  const filters: [string, any, any][] = [];
  if (range.startDate) {
    filters.push([dateField, '>=', range.startDate]);
  }
  if (range.endDate) {
    const endValue = dateFormat === 'isoDateTime' ? `${range.endDate}T23:59:59.999Z` : range.endDate;
    filters.push([dateField, '<=', endValue]);
  }
  return filters;
}

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  month: '1 Bulan Terakhir',
  two_months: '2 Bulan Terakhir',
  semester: '6 Bulan Terakhir (± Semester)',
  academic_year: 'Tahun Ajaran',
  custom: 'Rentang Tanggal Khusus',
  all: 'Semua Data',
};
