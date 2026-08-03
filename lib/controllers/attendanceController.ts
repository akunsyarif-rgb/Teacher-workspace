import * as attendanceService from '../services/attendanceService';

export async function fetchAttendanceHistory(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return attendanceService.listAttendanceHistory(workspaceId, className);
}

export async function submitAttendanceRecord(
  workspaceId: string,
  className: string,
  subject: string,
  students: { id: string; name: string; nis?: string }[],
  statusMap: Record<string, string>,
  scheduleId?: string | null
) {
  return attendanceService.submitAttendance(workspaceId, className, subject, students, statusMap, scheduleId);
}

export async function deleteAttendanceRecord(id: string) {
  return attendanceService.removeAttendance(id);
}
