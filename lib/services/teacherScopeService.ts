import { getAllSchedulesForSummary } from '../repositories/dashboardRepository';
import type { Doc } from '../adapters/firestoreAdapter';
import type { ScheduleData } from '../types/models';
import { withPersistentCache } from '../utils/persistentCache';
import { isMine, myClassNames, classNameVariants, type TeacherScope } from '../utils/teacherScope';

// Jadwal jarang berubah: disimpan di perangkat 10 menit (dibuang oleh clearAllCached() saat guru menyimpan perubahan).
export const SCHEDULES_TTL_MS = 10 * 60_000;

export function loadAllSchedulesCached(workspaceId: string): Promise<Doc<ScheduleData>[]> {
  return withPersistentCache(`dash:schedules:${workspaceId}`, SCHEDULES_TTL_MS, () => getAllSchedulesForSummary(workspaceId));
}

export type TeacherClasses = {
  mySchedules: Doc<ScheduleData>[];
  /** Nama kelas (trim) milik guru: dari jadwal miliknya + kelas wali. */
  classes: string[];
  /** Varian penulisan untuk query `in`. */
  variants: string[];
};

export async function loadTeacherClasses(workspaceId: string, scope: TeacherScope): Promise<TeacherClasses> {
  const all = await loadAllSchedulesCached(workspaceId);
  const mySchedules = all.filter((s) => isMine(s, scope.uid));
  const classes = myClassNames(all, scope);
  return { mySchedules, classes, variants: classNameVariants(all, classes) };
}
