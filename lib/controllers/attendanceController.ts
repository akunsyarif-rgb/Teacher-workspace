import * as attendanceService from '../services/attendanceService';

export async function fetchAttendanceHistory(className: string) {
  if (!className) return [];
  return attendanceService.listAttendanceHistory(className);
}

export async function submitAttendanceRecord(
  className: string,
  subject: string,
  students: { id: string; name: string; nis?: string }[],
  statusMap: Record<string, string>
) {
  return attendanceService.submitAttendance(className, subject, students, statusMap);
}

export async function deleteAttendanceRecord(id: string) {
  return attendanceService.removeAttendance(id);
}
