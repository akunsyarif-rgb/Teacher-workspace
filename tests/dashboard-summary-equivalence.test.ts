import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setPersistentStorageForTests } from '@/lib/utils/persistentCache';
import { shiftWitaDateString, getWitaDateString, getWitaDayName } from '@/lib/utils/witaDate';

const students = [
  { id: 's1', className: 'X-1 ' }, { id: 's2', className: 'X-1' }, { id: 's3', className: 'XI-A' }, { id: 's4' },
];
const day = () => getWitaDayName(new Date());
const schedules: { id: string; className: string; subject: string; timeSlot: string; day: string; createdBy?: string }[] = [
  { id: 'sc1', className: 'X-1', subject: 'MTK', timeSlot: '07:00 - 08:30', day: '' },
  { id: 'sc2', className: 'XI-A', subject: 'IPA', timeSlot: '09:00 - 10:30', day: '' },
  { id: 'sc3', className: 'X-1', subject: 'IPS', timeSlot: '11:00 - 12:30', day: 'Selasa-bukan' },
];
let journals: { id: string; date: string; className: string; scheduleId?: string }[] = [];
let attendances: { id: string; date: string; className: string }[] = [];
const calls: string[] = [];
const inScope = (d: { className: string }, c?: string[]) => !c || c.includes(d.className);

vi.mock('@/lib/repositories/dashboardRepository', () => ({
  getAllSchedulesForSummary: async () => (calls.push('schedules'), schedules),
  getJournalCount: async (_w: string, c?: string[]) => journals.filter((j) => inScope(j, c)).length,
  getJournalsOnDate: async (_w: string, d: string, c?: string[]) => journals.filter((j) => j.date === d && inScope(j, c)),
  getAttendancesOnDate: async (_w: string, d: string, c?: string[]) => attendances.filter((a) => a.date === d && inScope(a, c)),
  getJournalCountOnDate: async (_w: string, d: string, c?: string[]) => journals.filter((j) => j.date === d && inScope(j, c)).length,
  getAttendanceCountOnDate: async (_w: string, d: string, c?: string[]) => attendances.filter((a) => a.date === d && inScope(a, c)).length,
}));
vi.mock('@/lib/services/studentService', () => ({
  listClassSummaries: async () => {
    calls.push('students');
    const counts: Record<string, number> = {};
    students.forEach((s) => { const c = (s as { className?: string }).className?.trim(); if (c) counts[c] = (counts[c] || 0) + 1; });
    return Object.keys(counts).sort().map((className) => ({ className, count: counts[className] }));
  },
}));
vi.mock('@/lib/repositories/sessionSkipReasonRepository', () => ({
  getByDate: async () => [{ scheduleId: 'sc2', reason: 'Rapat', note: 'x' }],
}));

import { loadDashboardSummary } from '@/lib/services/dashboardService';

const ME = { uid: 'u1', role: 'TEACHER' as const };

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
    const out = await loadDashboardSummary('ws1', ME);
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

  it('pemuatan kedua memakai cache perangkat: jadwal tidak dibaca ulang', async () => {
    await loadDashboardSummary('ws1', ME);
    expect([...calls].sort()).toEqual(['schedules', 'students']);
    calls.length = 0;
    await loadDashboardSummary('ws1', ME);
    expect(calls.filter((c) => c === 'schedules')).toEqual([]); // jadwal dari cache perangkat (daftar kelas punya cache sendiri di studentService)
  });
});


describe('Beranda per guru', () => {
  beforeEach(() => {
    setPersistentStorageForTests(memoryStorage());
    calls.length = 0;
    const today = getWitaDateString();
    schedules.splice(0, schedules.length,
      { id: 'a1', className: 'X-1', subject: 'MTK', timeSlot: '07:00 - 08:30', day: day(), createdBy: 'u1' },
      { id: 'b1', className: 'XI-A', subject: 'IPA', timeSlot: '09:00 - 10:30', day: day(), createdBy: 'u2' },
      { id: 'l1', className: 'XII-B', subject: 'Lama', timeSlot: '11:00 - 12:30', day: day() }, // data lama tanpa createdBy
    );
    journals = [
      { id: 'j1', date: today, className: 'X-1', scheduleId: 'a1' },
      { id: 'j2', date: today, className: 'XI-A', scheduleId: 'b1' },
    ];
    attendances = [{ id: 'at1', date: today, className: 'XI-A' }];
  });

  it('hanya jadwal milik saya (+ data lama tanpa createdBy) dan kelas-kelasnya', async () => {
    const out = await loadDashboardSummary('ws1', ME);
    expect(out.todaySchedules.map((s) => s.id).sort()).toEqual(['a1', 'l1']);
    expect(out.uniqueClasses).toEqual(['X-1']); // XI-A milik guru lain; XII-B (data lama) tak punya siswa di mock
  });

  it('jurnal/presensi kelas guru lain tidak ikut menentukan status saya', async () => {
    const out = await loadDashboardSummary('ws1', ME);
    const a1 = out.todayClassStatuses.find((s) => s.scheduleId === 'a1')!;
    expect(a1.hasJournal).toBe(true);
    expect(a1.hasAttendance).toBe(false); // presensi X-1 tidak ada; yang ada milik XI-A (guru lain)
    expect(out.totalJournals).toBe(1); // hanya jurnal X-1 (XII-B belum punya)
  });

  it('guru lain melihat agendanya sendiri', async () => {
    const out = await loadDashboardSummary('ws1', { uid: 'u2', role: 'TEACHER' });
    expect(out.todaySchedules.map((s) => s.id).sort()).toEqual(['b1', 'l1']);
    expect(out.todayClassStatuses.find((s) => s.scheduleId === 'b1')!.hasAttendance).toBe(true);
  });

  it('guru tanpa kelas: ringkasan kosong dan tanpa membaca jurnal/presensi', async () => {
    schedules.splice(0, schedules.length, { id: 'b1', className: 'XI-A', subject: 'IPA', timeSlot: '09:00 - 10:30', day: day(), createdBy: 'u2' });
    const out = await loadDashboardSummary('ws1', ME);
    expect(out.todaySchedules).toEqual([]);
    expect(out.totalJournals).toBe(0);
    expect(out.weeklyStats.journalCounts).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
