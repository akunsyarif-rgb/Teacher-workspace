import * as submissionRepository from '../repositories/submissionRepository';
import * as studentRepository from '../repositories/studentRepository';
import * as gradeRepository from '../repositories/gradeRepository';
import { SUBMISSION_STATUS } from '../config/constants';
import { withTimeout } from '../utils/withTimeout';
import {
  canStudentSubmit,
  effectiveSubmissionStatus,
  hasStudentSubmitted,
  userError,
} from '../utils/submissionRules';


// Tulis Firestore juga bisa menggantung tanpa resolve/reject di jaringan
// yang putus diam-diam (SDK-nya mengantre write, bukan menolaknya), persis
// seperti unggah Storage. Tanpa batas ini tombol "Mengirim..." berputar
// selamanya tanpa satu pun penjelasan ke siswa.
const WRITE_TIMEOUT_MS = 30_000;

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
  return students.map((student: any) => {
    const submission = byStudentId[student.id];
    return {
      ...(submission || {}),
      assignmentId,
      studentId: student.id,
      studentName: student.name,
      studentNis: student.nis,
      // Status dihitung ulang dari isi dokumennya (lihat
      // effectiveSubmissionStatus): dokumen yang cuma memuat nilai/catatan
      // guru TIDAK boleh tampil sebagai "sudah mengumpulkan" di daftar
      // guru, karena siswanya memang belum mengirim apa pun.
      status: effectiveSubmissionStatus(submission),
      hasSubmitted: hasStudentSubmitted(submission),
    };
  });
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
  },
  // Tenggat tugasnya, supaya aturan "sudah lewat batas" ditegakkan di
  // sini — bukan cuma disembunyikan tombolnya di UI. Boleh kosong: tugas
  // tanpa tenggat berarti selalu terbuka.
  dueDate?: string | null
) {
  if (!workspaceId || !assignmentId || !studentId) throw userError('Data submission tidak valid.');
  const attachments: SubmissionAttachment[] =
    answer.attachments && answer.attachments.length > 0
      ? answer.attachments
      : answer.fileUrl
      ? [{ fileUrl: answer.fileUrl, fileName: answer.fileName || '', filePath: answer.filePath }]
      : [];
  if (!answer.textAnswer?.trim() && attachments.length === 0) {
    throw userError('Isi jawaban atau lampirkan foto dulu.');
  }

  // Dicek terhadap dokumen yang BENAR-BENAR tersimpan, bukan terhadap
  // salinan di layar siswa: layar bisa basi (gurunya baru saja menilai)
  // dan tenggat bisa terlewat sementara formnya dibiarkan terbuka.
  const existing = await submissionRepository.getSubmission(assignmentId, studentId);
  const gate = canStudentSubmit(existing, dueDate);
  if (!gate.allowed) throw userError(gate.reason, 'app/submission-closed');

  return withTimeout(
    submissionRepository.upsertSubmission(assignmentId, studentId, {
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
      // `feedback` SENGAJA tidak ikut ditulis di sini. Dokumennya ditulis
      // dengan merge, jadi catatan guru yang sudah ada tetap utuh walau
      // siswa memperbaiki jawabannya.
    }),
    'Pengumpulanmu belum bisa dipastikan tersimpan karena koneksi bermasalah. Buka lagi halaman ini setelah internet stabil untuk memeriksanya.',
    WRITE_TIMEOUT_MS
  );
}

/**
 * Catatan guru untuk satu pengumpulan — TERPISAH dari nilai.
 *
 * Guru boleh memberi catatan tanpa langsung menilai (mis. menyuruh
 * memperbaiki dulu), dan menyimpan nilai tidak menghapus catatan yang
 * sudah ada. Karena itu keduanya dua fungsi berbeda, bukan satu tulisan
 * gabungan seperti sebelumnya.
 */
export async function saveSubmissionFeedback(
  workspaceId: string,
  className: string,
  assignmentId: string,
  studentId: string,
  feedback: string
) {
  if (!workspaceId || !assignmentId || !studentId) {
    throw userError('Data catatan tidak valid.');
  }
  return submissionRepository.upsertSubmission(assignmentId, studentId, {
    workspaceId,
    className,
    feedback: feedback?.trim() || '',
  });
}

export async function gradeSubmission(
  workspaceId: string,
  className: string,
  assignmentId: string,
  gradeColumnId: string,
  studentId: string,
  score: string,
  feedback?: string,
  // Apakah siswa ini memang sudah mengumpulkan sesuatu. Datang dari daftar
  // submission yang baru saja dimuat panel penilaian (satu-satunya
  // pemanggil), bukan dari pembacaan ulang di sini: guru tidak punya izin
  // membaca dokumen submission yang belum ada, dan menambah izin itu untuk
  // guru tidak ada gunanya selain memperluas akses.
  hasSubmitted?: boolean
) {
  if (!workspaceId || !assignmentId || !gradeColumnId || !studentId) {
    throw userError('Data penilaian tidak valid.');
  }
  // Nilai tersimpan di collection `grades` yang sama dipakai gradebook biasa
  // (bukan disalin ke submission) — supaya sumber datanya cuma satu.
  await gradeRepository.saveGradesBatch(workspaceId, className, [
    { studentId, columnId: gradeColumnId, score },
  ]);

  const data: Record<string, any> = { workspaceId, className };

  // INI SUMBER BUG "siswa tidak bisa mengumpulkan tugas": dulu `status`
  // selalu dipaksa jadi 'dinilai' di sini, termasuk untuk siswa yang belum
  // mengirim apa pun. Akibatnya begitu guru mengisi nilai sekelas, tombol
  // Kumpulkan hilang dari layar siswa DAN firestore.rules ikut menolak
  // tulisannya — siswa terkunci permanen tanpa satu pun pesan.
  //
  // Menilai pekerjaan luring itu sah, jadi nilainya tetap disimpan; yang
  // tidak boleh adalah mengaku-akui siswa sudah mengumpulkan. Kalau belum
  // mengumpulkan, `status` sengaja TIDAK ditulis sama sekali (dokumennya
  // ditulis dengan merge) — menghilangkan field lebih aman daripada
  // menebak nilainya, dan status sesungguhnya tetap dihitung dari isi
  // dokumen lewat effectiveSubmissionStatus.
  if (hasSubmitted) {
    data.status = SUBMISSION_STATUS.DINILAI;
  }

  // Catatan hanya ditulis kalau guru memang menyertakannya — menyimpan
  // nilai dengan kolom catatan yang dibiarkan kosong tidak boleh menghapus
  // catatan yang sudah diberikan sebelumnya.
  if (feedback !== undefined) {
    data.feedback = feedback?.trim() || '';
  }

  return submissionRepository.upsertSubmission(assignmentId, studentId, data);
}
