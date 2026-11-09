import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setPersistentStorageForTests } from '@/lib/utils/persistentCache';
import { shiftWitaDateString, getWitaDateString, getWitaDayName } from '@/lib/utils/witaDate';

const students = [
  { id: 's1', className: 'X-1 ' }, { id: 's2', className: 'X-1' }, { id: 's3', className: 'XI-A' }, { id: 's4' },
];
const day = () => getWitaDayName(new Date());
const schedules = [
  { id: 'sc1', className: 'X-1', subject: 'MTK', timeSlot: '07:00 - 08:30', day: '' },
  { id: 'sc2', className: 'XI-A', subject: 'IPA', timeSlot: '09:00 - 10:30', day: '' },
  { id: 'sc3', className: 'X-1', subject: 'IPS', timeSlot: '11:00 - 12:30', day: 'Selasa-bukan' },
];
let journals: { id: string; date: string; className: string; scheduleId?: string }[] = [];
let attendances: { id: string; date: string; className: string }[] = [];
const calls: string[] = [];

vi.mock('@/lib/repositories/dashboardRepository', () => ({
  getAllStudentsForSummary: async () => (calls.push('students'), students),
  getAllSchedulesForSummary: async () => (calls.push('schedules'), schedules),
  getJournalCount: async () => journals.length,
  getJournalsOnDate: async (_w: string, d: string) => journals.filter((j) => j.date === d),
  getAttendancesOnDate: async (_w: string, d: string) => attendances.filter((a) => a.date === d),
  getJournalCountOnDate: async (_w: string, d: string) => journals.filter((j) => j.date === d).length,
  getAttendanceCountOnDate: async (_w: string, d: string) => attendances.filter((a) => a.date === d).length,
}));
vi.mock('@/lib/repositories/sessionSkipReasonRepository', () => ({
  getByDate: async () => [{ scheduleId: 'sc2', reason: 'Rapat', note: 'x' }],
}));

import { loadDashboardSummary } from '@/lib/services/dashboardService';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear() } as Storage;
}

describe('loadDashboardSummary: hasil sama dengan algoritma lama (baca semua 7 hari)', () => {
  beforeEach(() => {
    setPersistentStorageForTests(memoryStorage());
    calls.length = 0;
    schedules[0].day = day();
    schedules[1].day = day().toUpperCase();
    const today = getWitaDateString();
    journals = [
      { id: 'j1', date: today, className: 'X-1', scheduleId: 'sc1' },
      { id: 'j2', date: shiftWitaDateString(today, -2), className: 'X-1' },
      { id: 'j3', date: shiftWitaDateString(today, -6), className: 'XI-A' },
      { id: 'j4', date: shiftWitaDateString(today, -30), className: 'XI-A' },
    ];
    attendances = [
      { id: 'a1', date: today, className: 'X-1' },
      { id: 'a2', date: shiftWitaDateString(today, -1), className: 'X-1' },
      { id: 'a3', date: shiftWitaDateString(today, -6), className: 'X-1' },
    ];
  });

  it('keluaran sesuai perhitungan acuan', async () => {
    const today = getWitaDateString();
    const out = await loadDashboardSummary('ws1');
    expect(out.uniqueClasses.sort()).toEqual(['X-1', 'XI-A']);
    expect(out.totalJournals).toBe(4);
    expect(out.todayClassStatuses.map((s) => [s.scheduleId, s.hasJournal, s.hasAttendance, s.isDone, s.isSkipped]))
      .toEqual([['sc1', true, true, true, false], ['sc2', false, false, false, true]]);
    expect(out.todayProgress).toEqual({ total: 1, journalsDone: 1, attendancesDone: 1, percentage: 100 });
    expect(out.pendingClasses).toEqual([]);
    // weeklyStats: 7 hari berurutan lama→hari ini, sama dengan menghitung dari seluruh dokumen 7 hari
    const expectJ = Array.from({ length: 7 }, (_, k) => journals.filter((j) => j.date === shiftWitaDateString(today, -(6 - k))).length);
    const expectA = Array.from({ length: 7 }, (_, k) => attendances.filter((a) => a.date === shiftWitaDateString(today, -(6 - k))).length);
    expect(out.weeklyStats.journalCounts).toEqual(expectJ);
    expect(out.weeklyStats.attendanceCounts).toEqual(expectA);
    expect(out.weeklyStats.days).toHaveLength(7);
  });

  it('pemuatan kedua memakai cache perangkat: siswa & jadwal tidak dibaca ulang', async () => {
    await loadDashboardSummary('ws1');
    expect(calls).toEqual(['students', 'schedules']);
    calls.length = 0;
    await loadDashboardSummary('ws1');
    expect(calls).toEqual([]);
  });
});
