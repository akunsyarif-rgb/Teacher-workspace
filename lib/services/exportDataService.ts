import * as dataArchiveRepository from '../repositories/dataArchiveRepository';
import * as studentRepository from '../repositories/studentRepository';
import * as studentService from '../services/studentService';
import * as gradeService from '../services/gradeService';
import { DATA_LIFECYCLE_COLLECTIONS } from '../config/dataLifecycleCollections';
import { DateRange } from '../utils/periodRange';

export type ExportScope = { type: 'all' } | { type: 'class'; className: string };

const LIFECYCLE_KEYS = DATA_LIFECYCLE_COLLECTIONS.map((c) => c.key);

async function listStudentsForScope(workspaceId: string, scope: ExportScope) {
  return scope.type === 'class'
    ? studentService.getStudentsInClass(workspaceId, scope.className)
    : studentRepository.getAllStudents(workspaceId);
}

// Presensi: `details` per sesi SUDAH menyimpan nama+NIS siswa (denormalisasi
// saat presensi disimpan, lihat attendanceService.buildAttendancePayload) —
// diratakan jadi satu baris per (sesi, siswa) di sini supaya siap
// CSV/PDF tanpa join tambahan.
function flattenAttendances(sessions: any[]) {
  const rows: any[] = [];
  sessions.forEach((session) => {
    (session.details || []).forEach((d: any) => {
      rows.push({
        date: session.date,
        className: session.className,
        subject: session.subject,
        studentName: d.name,
        nis: d.nis,
        status: d.status,
        late: d.late ? 'Ya' : '-',
      });
    });
  });
  return rows;
}

// Submission TIDAK menyimpan nama siswa/judul tugas sendiri — diperkaya
// (enrich) di sini lewat lookup sekali jalan, bukan N+1 query per baris.
async function enrichSubmissions(workspaceId: string, submissions: any[], scope: ExportScope) {
  if (submissions.length === 0) return [];
  const students = await listStudentsForScope(workspaceId, scope);
  const studentById: Record<string, any> = {};
  students.forEach((s: any) => (studentById[s.id] = s));

  return submissions.map((sub: any) => ({
    date: (sub.submittedAt || '').split('T')[0] || '-',
    className: sub.className || '-',
    studentName: studentById[sub.studentId]?.name || sub.studentId,
    status: sub.status,
    textAnswer: sub.textAnswer || '-',
    fileName: sub.fileName || '-',
    feedback: sub.feedback || '-',
  }));
}

// Kumpulkan dataset mentah (bukan sudah diformat CSV/PDF) sesuai jenis
// data yang dipilih + periode + scope (semua kelas / satu kelas) — dipakai
// bersama oleh ketiga format Download Data (PDF/CSV/JSON Arsip Lengkap)
// supaya isinya selalu konsisten satu sama lain.
export async function gatherExportData(
  workspaceId: string,
  dataTypeKeys: string[],
  range: DateRange,
  scope: ExportScope
): Promise<Record<string, any[]>> {
  if (!workspaceId) return {};
  const className = scope.type === 'class' ? scope.className : undefined;
  const result: Record<string, any[]> = {};

  await Promise.all(
    dataTypeKeys.map(async (key) => {
      if (key === 'attendances') {
        const sessions = await dataArchiveRepository.listLifecycleData('attendances', workspaceId, range, className);
        result.attendances = flattenAttendances(sessions);
        return;
      }
      if (key === 'submissions') {
        const raw = await dataArchiveRepository.listLifecycleData('submissions', workspaceId, range, className);
        result.submissions = await enrichSubmissions(workspaceId, raw, scope);
        return;
      }
      if (LIFECYCLE_KEYS.includes(key)) {
        result[key] = await dataArchiveRepository.listLifecycleData(key, workspaceId, range, className);
        return;
      }
      if (key === 'students') {
        result.students = await listStudentsForScope(workspaceId, scope);
        return;
      }
      if (key === 'grades') {
        result.grades = await gatherGrades(workspaceId, scope);
        return;
      }
    })
  );

  return result;
}

// Nilai TIDAK difilter periode (lihat dataLifecycleCollections.ts) — hasil
// di sini selalu "nilai saat ini", diratakan (flatten) jadi satu baris per
// (siswa, kolom nilai) supaya gampang jadi CSV/PDF, bukan bentuk map
// bersarang yang dipakai GradesTable.
async function gatherGrades(workspaceId: string, scope: ExportScope) {
  const classNames =
    scope.type === 'class'
      ? [scope.className]
      : (await studentService.listClassSummaries(workspaceId)).map((s: any) => s.className);

  const rows: any[] = [];
  for (const className of classNames) {
    const [{ columns, grades }, students] = await Promise.all([
      gradeService.loadGradeData(workspaceId, className),
      studentService.getStudentsInClass(workspaceId, className),
    ]);
    const columnById: Record<string, any> = {};
    columns.forEach((c: any) => (columnById[c.id] = c));

    students.forEach((student: any) => {
      const studentGrades = grades[student.id] || {};
      Object.keys(studentGrades).forEach((columnId) => {
        const score = studentGrades[columnId];
        if (score === undefined || score === '') return;
        rows.push({
          className,
          studentName: student.name,
          nis: student.nis || '-',
          columnTitle: columnById[columnId]?.title || columnId,
          columnType: columnById[columnId]?.type || '-',
          score,
        });
      });
    });
  }
  return rows;
}
