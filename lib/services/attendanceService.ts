import * as attendanceRepository from '../repositories/attendanceRepository';
import { ATTENDANCE_STATUS_OPTIONS } from '../config/constants';

export async function listAttendanceHistory(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return attendanceRepository.getAttendanceByClass(workspaceId, className);
}

export type AttendanceEntry = { status: string; late?: boolean };

export async function submitAttendance(
  workspaceId: string,
  className: string,
  subject: string,
  students: { id: string; name: string; nis?: string }[],
  statusMap: Record<string, AttendanceEntry>,
  scheduleId?: string | null
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  if (!className) throw new Error('Kelas tidak valid.');
  // "Terlambat" bukan status sendiri — cuma atribut tambahan di atas
  // Hadir (late: true), supaya siswa terlambat tetap terhitung hadir di
  // rekap, sambil tetap tercatat terpisah di summary.terlambat untuk
  // visibilitas disiplin.
  const summary: Record<string, number> = { hadir: 0, sakit: 0, izin: 0, dispensasi: 0, alpa: 0, terlambat: 0 };
  const details = students.map((student) => {
    const entry = statusMap[student.id];
    const status = (ATTENDANCE_STATUS_OPTIONS as readonly string[]).includes(entry?.status as any)
      ? entry.status
      : 'Hadir';
    const late = status === 'Hadir' && !!entry?.late;
    const key = status.toLowerCase();
    if (summary[key] !== undefined) summary[key] += 1;
    if (late) summary.terlambat += 1;
    return { studentId: student.id, name: student.name, nis: student.nis || '-', status, late };
  });
  return attendanceRepository.createAttendance({
    workspaceId,
    className,
    subject: subject.trim(),
    date: new Date().toISOString().split('T')[0],
    summary,
    details,
    scheduleId: scheduleId ?? null,
  });
}

export async function removeAttendance(id: string) {
  return attendanceRepository.deleteAttendance(id);
}
