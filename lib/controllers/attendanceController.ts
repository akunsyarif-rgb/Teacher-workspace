import * as attendanceService from '../services/attendanceService';
import type { AttendanceEntry } from '../services/attendanceService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export type { AttendanceEntry };

export function attendanceHistoryCacheKey(workspaceId: string, className: string) {
  return `attendanceHistory:${workspaceId}:${className}`;
}

export async function fetchAttendanceHistory(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(attendanceHistoryCacheKey(workspaceId, className), () =>
    attendanceService.listAttendanceHistory(workspaceId, className)
  );
}

export async function submitAttendanceRecord(
  workspaceId: string,
  className: string,
  subject: string,
  students: { id: string; name: string; nis?: string }[],
  statusMap: Record<string, AttendanceEntry>,
  scheduleId?: string | null
) {
  const result = await attendanceService.submitAttendance(
    workspaceId,
    className,
    subject,
    students,
    statusMap,
    scheduleId
  );
  clearAllCached();
  return result;
}

export async function deleteAttendanceRecord(id: string) {
  const result = await attendanceService.removeAttendance(id);
  clearAllCached();
  return result;
}
