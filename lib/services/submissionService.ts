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
  // studentName/studentNis dipaksa dari data siswa (bukan submission doc,
  // yang tidak menyimpan nama) supaya UI tidak perlu join terpisah.
  return students.map((student: any) => ({
    status: SUBMISSION_STATUS.BELUM_MENGUMPULKAN,
    ...(byStudentId[student.id] || {}),
    assignmentId,
    studentId: student.id,
    studentName: student.name,
    studentNis: student.nis,
  }));
}

type SubmissionAttachment = { fileUrl: string; fileName: string; filePath?: string };

export async function submitAssignment(
  workspaceId: string,
  assignmentId: string,
  studentId: string,
  className: string,
  answer: {
    textAnswer?: string;
    attachments?: SubmissionAttachment[];
    // Bentuk lama (satu lampiran) — tetap didukung supaya pemanggil lama
    // (mis. "pertahankan lampiran sebelumnya" tanpa unggah ulang) tidak
    // perlu diubah semua.
    fileUrl?: string;
    fileName?: string;
    filePath?: string;
  }
) {
  if (!workspaceId || !assignmentId || !studentId) throw new Error('Data submission tidak valid.');
  const attachments: SubmissionAttachment[] =
    answer.attachments && answer.attachments.length > 0
      ? answer.attachments
      : answer.fileUrl
      ? [{ fileUrl: answer.fileUrl, fileName: answer.fileName || '', filePath: answer.filePath }]
      : [];
  if (!answer.textAnswer?.trim() && attachments.length === 0) {
    throw new Error('Jawaban atau file wajib diisi.');
  }
  return submissionRepository.upsertSubmission(assignmentId, studentId, {
    workspaceId,
    className,
    textAnswer: answer.textAnswer?.trim() || '',
    // Semua lampiran (maks 5) tersimpan di sini. fileUrl/fileName/filePath
    // di bawah TETAP diisi (lampiran pertama) untuk kompatibilitas mundur
    // dengan bagian lain yang masih membaca field tunggal (rekap, ekspor,
    // portofolio siswa) — bukan dihapus, supaya data lama & fitur lain
    // yang belum diperbarui tetap jalan.
    attachments,
    fileUrl: attachments[0]?.fileUrl || null,
    fileName: attachments[0]?.fileName || null,
    // filePath disimpan terpisah dari fileUrl: URL-nya bertoken dan bisa
    // berubah kalau file diunggah ulang, sedangkan path-nya stabil —
    // berguna untuk menelusuri file di bucket saat ada masalah.
    filePath: attachments[0]?.filePath || null,
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
