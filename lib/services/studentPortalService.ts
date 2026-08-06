import * as scheduleRepository from '../repositories/scheduleRepository';
import * as assignmentRepository from '../repositories/assignmentRepository';
import * as submissionRepository from '../repositories/submissionRepository';
import * as gradeRepository from '../repositories/gradeRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';
import * as attendanceRepository from '../repositories/attendanceRepository';
import { SUBMISSION_STATUS, SCHOOL_DAYS_6 } from '../config/constants';

export type StudentScope = {
  workspaceId: string;
  className: string;
  studentId: string;
};

export async function getSchedule({ workspaceId, className }: StudentScope) {
  const schedules = await scheduleRepository.getSchedulesByClass(workspaceId, className);
  const byDay = SCHOOL_DAYS_6.map((day) => ({
    day,
    items: schedules
      .filter((s: any) => s.day === day)
      .sort((a: any, b: any) => (a.timeSlot || '').localeCompare(b.timeSlot || '')),
  }));
  return byDay;
}

// Daftar tugas kelas digabung dengan submission milik siswa ini saja.
// Tugas tanpa dokumen submission = belum dikumpulkan (lihat submissionService).
export async function getAssignments({ workspaceId, className, studentId }: StudentScope) {
  const [assignments, submissions] = await Promise.all([
    assignmentRepository.getAssignmentsByClass(workspaceId, className),
    submissionRepository.getSubmissionsByStudent(workspaceId, studentId),
  ]);
  const byAssignmentId: Record<string, any> = {};
  submissions.forEach((sub: any) => {
    byAssignmentId[sub.assignmentId] = sub;
  });
  return assignments
    .map((assignment: any) => {
      const submission = byAssignmentId[assignment.id];
      return {
        ...assignment,
        status: submission?.status || SUBMISSION_STATUS.BELUM_MENGUMPULKAN,
        textAnswer: submission?.textAnswer || '',
        fileUrl: submission?.fileUrl || null,
        fileName: submission?.fileName || null,
        feedback: submission?.feedback || '',
        submittedAt: submission?.submittedAt || null,
      };
    })
    .sort((a: any, b: any) => (a.dueDate || '').localeCompare(b.dueDate || ''));
}

// Nilai siswa ini dipasangkan dengan judul kolomnya. Kolom yang belum
// dinilai tetap ditampilkan (score null) supaya siswa tahu komponen apa
// saja yang ada dan mana yang masih kosong.
export async function getGrades({ workspaceId, className, studentId }: StudentScope) {
  const [columns, grades] = await Promise.all([
    gradeColumnRepository.getColumnsByClass(workspaceId, className),
    gradeRepository.getGradesByStudent(workspaceId, studentId),
  ]);
  const byColumnId: Record<string, string> = {};
  grades.forEach((grade: any) => {
    byColumnId[grade.columnId] = grade.score;
  });

  const items = columns.map((column: any) => ({
    id: column.id,
    title: column.title,
    type: column.type,
    score: byColumnId[column.id] ?? null,
  }));

  // Kolom yang belum dinilai (score null / string kosong) tidak boleh ikut
  // dirata-rata — Number(null) itu 0, dan kalau lolos ke sini rata-rata
  // siswa akan tampak jatuh hanya karena gurunya belum sempat menilai.
  const numericScores = items
    .filter((item) => item.score !== null && String(item.score).trim() !== '')
    .map((item) => Number(item.score))
    .filter((score) => Number.isFinite(score));
  const average =
    numericScores.length > 0
      ? numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length
      : null;

  return { items, average };
}

// Satu dokumen presensi = satu sesi mengajar berisi status seluruh kelas;
// di sini disaring jadi baris milik siswa ini saja.
export async function getAttendance({ workspaceId, className, studentId }: StudentScope) {
  const records = await attendanceRepository.getAttendanceByClass(workspaceId, className);
  const summary: Record<string, number> = { Hadir: 0, Sakit: 0, Izin: 0, Dispensasi: 0, Alpa: 0 };
  let lateCount = 0;

  const history = records
    .map((record: any) => {
      const mine = (record.details || []).find((detail: any) => detail.studentId === studentId);
      if (!mine) return null;
      if (summary[mine.status] !== undefined) summary[mine.status] += 1;
      if (mine.late) lateCount += 1;
      return {
        id: record.id,
        date: record.date,
        subject: record.subject,
        status: mine.status,
        late: !!mine.late,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));

  const total = history.length;
  const attendanceRate = total > 0 ? Math.round((summary.Hadir / total) * 100) : null;

  return { history, summary, lateCount, total, attendanceRate };
}
