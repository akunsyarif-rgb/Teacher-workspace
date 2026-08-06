import * as submissionRepository from '../repositories/submissionRepository';
import * as studentRepository from '../repositories/studentRepository';
import * as gradeRepository from '../repositories/gradeRepository';
import { SUBMISSION_STATUS } from '../config/constants';

// Gabungkan daftar siswa sekelas dengan dokumen submission yang ada. Siswa
// tanpa dokumen submission dianggap BELUM_MENGUMPULKAN — tidak perlu
// pre-create dokumen kosong untuk tiap siswa saat tugas dibuat.
export async function getSubmissionsForAssignment(
  workspaceId: string,
  className: string,
  assignmentId: string
) {
  if (!workspaceId || !className || !assignmentId) return [];
  const [students, submissions] = await Promise.all([
    studentRepository.getStudentsByClass(workspaceId, className),
    submissionRepository.getSubmissionsByAssignment(workspaceId, assignmentId),
  ]);
  const byStudentId: Record<string, any> = {};
  submissions.forEach((sub: any) => {
    byStudentId[sub.studentId] = sub;
  });
  return students.map((student: any) => (
    byStudentId[student.id] || {
      assignmentId,
      studentId: student.id,
      status: SUBMISSION_STATUS.BELUM_MENGUMPULKAN,
    }
  ));
}

export async function submitAssignment(
  workspaceId: string,
  assignmentId: string,
  studentId: string,
  className: string,
  answer: { textAnswer?: string; fileUrl?: string; fileName?: string }
) {
  if (!workspaceId || !assignmentId || !studentId) throw new Error('Data submission tidak valid.');
  if (!answer.textAnswer?.trim() && !answer.fileUrl) {
    throw new Error('Jawaban atau file wajib diisi.');
  }
  return submissionRepository.upsertSubmission(assignmentId, studentId, {
    workspaceId,
    className,
    textAnswer: answer.textAnswer?.trim() || '',
    fileUrl: answer.fileUrl || null,
    fileName: answer.fileName || null,
    status: SUBMISSION_STATUS.MENUNGGU_PENILAIAN,
    submittedAt: new Date().toISOString(),
  });
}

export async function gradeSubmission(
  workspaceId: string,
  className: string,
  assignmentId: string,
  gradeColumnId: string,
  studentId: string,
  score: string,
  feedback?: string
) {
  if (!workspaceId || !assignmentId || !gradeColumnId || !studentId) {
    throw new Error('Data penilaian tidak valid.');
  }
  // Nilai tersimpan di collection `grades` yang sama dipakai gradebook biasa
  // (bukan disalin ke submission) — supaya sumber datanya cuma satu.
  await gradeRepository.saveGradesBatch(workspaceId, className, [
    { studentId, columnId: gradeColumnId, score },
  ]);
  return submissionRepository.upsertSubmission(assignmentId, studentId, {
    workspaceId,
    className,
    status: SUBMISSION_STATUS.DINILAI,
    feedback: feedback?.trim() || '',
  });
}
