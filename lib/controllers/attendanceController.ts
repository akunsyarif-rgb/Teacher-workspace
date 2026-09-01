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

export function attendanceHistoryRangeCacheKey(
  workspaceId: string,
  className: string,
  startDate: string,
  endDate: string
) {
  return `attendanceHistoryRange:${workspaceId}:${className}:${startDate}:${endDate}`;
}

// Dipakai TimelineTab — jendela tanggal, bukan seluruh riwayat. Lihat
// komentar di attendanceRepository.getAttendanceByClassInRange.
export async function fetchAttendanceHistoryInRange(
  workspaceId: string,
  className: string,
  startDate: string,
  endDate: string
) {
  if (!workspaceId || !className) return [];
  return withCache(attendanceHistoryRangeCacheKey(workspaceId, className, startDate, endDate), () =>
    attendanceService.listAttendanceHistoryInRange(workspaceId, className, startDate, endDate)
  );
}

export async function fetchTodayAttendance(workspaceId: string, className: string, scheduleId?: string | null) {
  return attendanceService.loadTodayAttendance(workspaceId, className, scheduleId);
}

export async function autoSaveAttendanceRecord(
  existingId: string | null,
  workspaceId: string,
  className: string,
  subject: string,
  students: { id: string; name: string; nis?: string }[],
  statusMap: Record<string, AttendanceEntry>,
  scheduleId?: string | null
) {
  const id = await attendanceService.autoSaveAttendance(
    existingId,
    workspaceId,
    className,
    subject,
    students,
    statusMap,
    scheduleId
  );
  clearAllCached();
  return id;
}

export async function markAttendanceCompleted(id: string) {
  const result = await attendanceService.markAttendanceCompleted(id);
  clearAllCached();
  return result;
}

export async function deleteAttendanceRecord(id: string) {
  const result = await attendanceService.removeAttendance(id);
  clearAllCached();
  return result;
}
