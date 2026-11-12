import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setPersistentStorageForTests } from '@/lib/utils/persistentCache';
import { isMine, myClassNames, classNameVariants, classSignature } from '@/lib/utils/teacherScope';
import { getWitaDateString } from '@/lib/utils/witaDate';

const reads: string[] = [];
const schedules = [
  { id: 's1', className: 'X-1 ', createdBy: 'u1' },
  { id: 's2', className: 'XI-A', createdBy: 'u2' },
  { id: 's3', className: 'XII-B' }, // data lama
];
const today = () => getWitaDateString();
const att = (cls: string, sid: string, status: string) => ({ id: `a-${cls}`, date: today(), className: cls, details: [{ studentId: sid, name: sid, status }] });
// 4 alpa agar memicu temuan kehadiran
const attendances = ['X-1', 'XI-A'].flatMap((c) => Array.from({ length: 4 }, (_, i) => ({ ...att(c, `siswa-${c}`, 'Alpa'), id: `a-${c}-${i}` })));

vi.mock('@/lib/repositories/dashboardRepository', () => ({
  getAllSchedulesForSummary: async () => (reads.push('schedules'), schedules),
  getAttendancesInRange: async (_w: string, _a: string, _b: string, classes?: string[]) => {
    reads.push(`att:${classes ? classes.join(',') : 'ALL'}`);
    return attendances.filter((a) => !classes || classes.includes(a.className) || classes.includes(a.className + ' '));
  },
  getJournalsInRange: async () => [],
}));
vi.mock('@/lib/repositories/analyticsRepository', () => ({
  getAssignmentsDueInRange: async () => [],
  getSubmissionCountsForAssignments: async () => ({}),
}));
vi.mock('@/lib/services/studentService', () => ({
  listClassSummaries: async () => [{ className: 'X-1', count: 30 }, { className: 'XI-A', count: 30 }],
}));

import { loadInsights } from '@/lib/services/analyticsService';

function mem(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear() } as Storage;
}
beforeEach(() => { setPersistentStorageForTests(mem()); reads.length = 0; });

describe('teacherScope (murni)', () => {
  it('isMine: milik sendiri atau data lama tanpa createdBy', () => {
    expect(isMine({ createdBy: 'u1' }, 'u1')).toBe(true);
    expect(isMine({}, 'u1')).toBe(true);
    expect(isMine({ createdBy: 'u2' }, 'u1')).toBe(false);
  });
  it('myClassNames: dari jadwal milik + kelas wali, ter-trim dan unik', () => {
    expect(myClassNames(schedules, { uid: 'u1' })).toEqual(['X-1', 'XII-B']);
    expect(myClassNames(schedules, { uid: 'u1', homeroomClassName: ' IX-C ' })).toEqual(['IX-C', 'X-1', 'XII-B']);
    expect(classNameVariants(schedules, ['X-1'])).toEqual(['X-1', 'X-1 ']);
  });
  it('classSignature stabil terhadap urutan dan berbeda untuk himpunan berbeda', () => {
    expect(classSignature(['a', 'b'])).toBe(classSignature(['b', 'a']));
    expect(classSignature(['a'])).not.toBe(classSignature(['a', 'b']));
  });
});

describe('Analitik per guru', () => {
  const titles = (r: { insights: { title: string }[] }) => r.insights.map((i) => i.title).join('|');

  it('guru hanya melihat kelas miliknya; kelas guru lain tidak ikut dibaca', async () => {
    const r = await loadInsights('ws', { uid: 'u1', role: 'TEACHER' });
    expect(titles(r)).toContain('X-1');
    expect(titles(r)).not.toContain('XI-A');
    expect(reads.some((x) => x.startsWith('att:') && !x.includes('XI-A'))).toBe(true);
  });

  it('OWNER/ADMIN melihat seluruh workspace', async () => {
    const r = await loadInsights('ws', { uid: 'boss', role: 'OWNER' });
    expect(titles(r)).toContain('X-1');
    expect(titles(r)).toContain('XI-A');
    expect(reads).toContain('att:ALL');
  });

  it('guru tanpa kelas: hasil kosong tanpa membaca presensi', async () => {
    const r = await loadInsights('ws', { uid: 'u3-baru', role: 'TEACHER' }); // hanya jadwal lama (XII-B) → ada kelas
    expect(r.insights.length).toBe(0); // XII-B tak punya presensi
    schedules.length = 2; // hapus data lama; u3 tak punya jadwal
    reads.length = 0;
    setPersistentStorageForTests(mem());
    const r2 = await loadInsights('ws', { uid: 'u3-baru', role: 'TEACHER' });
    expect(r2.insights).toEqual([]);
    expect(reads.filter((x) => x.startsWith('att:'))).toEqual([]);
  });
});
