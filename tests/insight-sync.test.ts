import { describe, it, expect } from 'vitest';
import type { AttendanceLike, JournalLike } from '@/lib/utils/insights';
import { buildInsights, buildInsightsFromAggregates, countStudentsPerClass, countSubmissionsPerAssignment } from '@/lib/utils/insights';
import { rollupDays, mergeDays, planInsightSync, applyInsightFetch, type InsightSyncState } from '@/lib/utils/insightSync';
import { shiftWitaDateString } from '@/lib/utils/witaDate';

const today = '2026-11-10';
const ws = shiftWitaDateString(today, -29);
const statuses = ['Hadir', 'Hadir', 'Alpa', 'Sakit', 'Hadir', 'Alpa'];

function makeData() {
  const students = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, className: i < 6 ? 'X-1' : 'X-2', name: `N${i}` }));
  const attendances: AttendanceLike[] = [];
  const journals: JournalLike[] = [];
  for (let d = 0; d < 30; d++) {
    const date = shiftWitaDateString(today, -d);
    for (const cls of ['X-1', 'X-2']) {
      attendances.push({ id: `a-${cls}-${date}`, date, className: cls, details: students.filter((s) => s.className === cls).map((s, k) => ({ studentId: s.id, name: s.name, status: statuses[(d + k + (cls === 'X-1' ? 0 : 2)) % statuses.length] })) });
      if ((d + (cls === 'X-1' ? 1 : 0)) % 3 !== 0) journals.push({ id: `j-${cls}-${date}`, date, className: cls });
    }
  }
  const assignments = [{ id: 'as1', className: 'X-1', title: 'T', dueDate: shiftWitaDateString(today, -5) }];
  const submissions = [{ assignmentId: 'as1' }, { assignmentId: 'as1' }];
  return { students, attendances, journals, assignments, submissions };
}

const sortIds = (r: { id: string }[]) => r.map((i) => i.id).sort();

describe('Analitik bertahap == Analitik penuh', () => {
  it('sinkron penuh dari rekap harian menghasilkan temuan yang sama dengan jalur mentah', () => {
    const d = makeData();
    const raw = buildInsights({ ...d, today });
    const state = applyInsightFetch(undefined, ws, ws, today, rollupDays(d.attendances, d.journals), true);
    const { perStudent, missingJournals } = mergeDays(state.days);
    const inc = buildInsightsFromAggregates({
      perStudent, missingJournals, studentsPerClass: countStudentsPerClass(d.students),
      submissionCount: countSubmissionsPerAssignment(d.submissions), assignments: d.assignments, today,
    });
    expect(sortIds(inc)).toEqual(sortIds(raw));
    expect(inc.map((i) => i.detail).sort()).toEqual(raw.map((i) => i.detail).sort());
    expect(raw.length).toBeGreaterThan(0);
  });

  it('sinkron jendela 3 hari setelah beberapa hari = hasil penuh pada data terbaru', () => {
    const d = makeData();
    const t0 = shiftWitaDateString(today, -2);
    const old = { ...d, attendances: d.attendances.filter((a) => (a.date as string) <= t0), journals: d.journals.filter((j) => (j.date as string) <= t0) };
    const ws0 = shiftWitaDateString(t0, -29);
    let state: InsightSyncState = applyInsightFetch(undefined, ws0, ws0, t0, rollupDays(old.attendances, old.journals), true);
    const plan = planInsightSync(state, today, ws, shiftWitaDateString);
    expect(plan.kind).toBe('window');
    const from = (plan as { from: string }).from;
    const att = d.attendances.filter((a) => (a.date as string) >= from);
    const jr = d.journals.filter((j) => (j.date as string) >= from);
    state = applyInsightFetch(state, from, ws, today, rollupDays(att, jr), false);
    const full = buildInsights({ ...d, today });
    const { perStudent, missingJournals } = mergeDays(state.days);
    const inc = buildInsightsFromAggregates({
      perStudent, missingJournals, studentsPerClass: countStudentsPerClass(d.students),
      submissionCount: countSubmissionsPerAssignment(d.submissions), assignments: d.assignments, today,
    });
    expect(sortIds(inc)).toEqual(sortIds(full));
  });

  it('sinkron penuh bila belum ada state atau sudah >7 hari', () => {
    expect(planInsightSync(undefined, today, ws, shiftWitaDateString).kind).toBe('full');
    const old: InsightSyncState = { days: {}, syncedThrough: '2026-10-01', fullAt: '2026-10-01' };
    expect(planInsightSync(old, today, ws, shiftWitaDateString).kind).toBe('full');
  });
});
