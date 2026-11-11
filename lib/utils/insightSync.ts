// Sinkronisasi bertahap data Analitik (presensi + jurnal 30 hari). Hari lampau tidak diunduh ulang: tiap hari
// diringkas jadi rekap kecil (per siswa: hadir/alpa/total; plus sesi tanpa jurnal) dan disimpan di perangkat.
// Hanya OVERLAP_DAYS terakhir yang dibaca ulang. Batas kebasian: presensi/jurnal hari yang lebih tua dari
// OVERLAP_DAYS yang diubah/diisi belakangan baru terlihat pada sinkron penuh berikutnya (FULL_RESYNC_DAYS).
import { aggregateAttendance, findMissingJournals, type AttendanceLike, type JournalLike, type MissingJournal, type StudentAgg } from './insights';

export const INSIGHT_OVERLAP_DAYS = 3;
export const INSIGHT_FULL_RESYNC_DAYS = 7;

export type DayRollup = { students: Record<string, StudentAgg>; missing: MissingJournal[] };
export type InsightSyncState = { days: Record<string, DayRollup>; syncedThrough: string; fullAt: string };

type Dated = { date?: string };

function groupByDate<T extends Dated>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) {
    const d = r.date || '';
    (out[d] ||= []).push(r);
  }
  return out;
}

/** Ringkas dokumen mentah menjadi rekap per tanggal (hanya tanggal yang punya presensi). */
export function rollupDays(attendances: AttendanceLike[], journals: JournalLike[]): Record<string, DayRollup> {
  const att = groupByDate(attendances);
  const jr = groupByDate(journals);
  const out: Record<string, DayRollup> = {};
  for (const date of Object.keys(att)) {
    out[date] = { students: aggregateAttendance(att[date]), missing: findMissingJournals(att[date], jr[date] || []) };
  }
  return out;
}

export function planInsightSync(
  state: InsightSyncState | undefined,
  today: string,
  windowStart: string,
  shift: (d: string, n: number) => string
): { kind: 'full' } | { kind: 'window'; from: string } {
  if (!state || !state.fullAt || !state.syncedThrough) return { kind: 'full' };
  if (state.fullAt < shift(today, -INSIGHT_FULL_RESYNC_DAYS)) return { kind: 'full' };
  const from = shift(state.syncedThrough, -INSIGHT_OVERLAP_DAYS);
  return { kind: 'window', from: from < windowStart ? windowStart : from };
}

/** Terapkan hasil unduhan [from..today] ke state: hari >= from diganti, hari < windowStart dibuang. */
export function applyInsightFetch(
  state: InsightSyncState | undefined,
  from: string,
  windowStart: string,
  today: string,
  fetched: Record<string, DayRollup>,
  full: boolean
): InsightSyncState {
  const days: Record<string, DayRollup> = {};
  if (state && !full) {
    for (const [d, r] of Object.entries(state.days)) if (d < from && d >= windowStart) days[d] = r;
  }
  for (const [d, r] of Object.entries(fetched)) if (d >= windowStart) days[d] = r;
  return { days, syncedThrough: today, fullAt: full || !state ? today : state.fullAt };
}

/** Gabung rekap harian (lama → baru) menjadi masukan buildInsightsFromAggregates. */
export function mergeDays(days: Record<string, DayRollup>) {
  const perStudent: Record<string, StudentAgg> = {};
  const missingJournals: MissingJournal[] = [];
  for (const date of Object.keys(days).sort()) {
    const day = days[date];
    for (const [sid, s] of Object.entries(day.students)) {
      const cur = perStudent[sid];
      if (!cur) perStudent[sid] = { ...s };
      else {
        cur.hadir += s.hadir;
        cur.alpa += s.alpa;
        cur.total += s.total;
      }
    }
    missingJournals.push(...day.missing);
  }
  return { perStudent, missingJournals };
}
