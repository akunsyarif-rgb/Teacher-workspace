import { SUBMISSION_STATUS } from '../config/constants';
import { getWitaDateString } from './witaDate';

/**
 * Aturan murni seputar pengumpulan tugas: kapan siswa masih boleh
 * mengumpulkan, apa status sebenarnya sebuah dokumen submission, dan
 * bagaimana kegagalan diterjemahkan jadi kalimat yang bisa dibaca siswa.
 *
 * Dipisah dari service supaya bisa diuji tanpa Firestore sama sekali —
 * ini kategori aturan yang paling mahal kalau salah diam-diam: bug
 * "siswa tidak bisa mengumpulkan tugas" hidup persis di sini.
 */

// Index signature-nya disengaja: pemanggilnya adalah dokumen Firestore apa
// adanya (getDocument mengembalikan bentuk lepas), dan yang dipedulikan
// fungsi-fungsi di bawah cuma beberapa field ini.
export type SubmissionLike =
  | ({
      status?: string | null;
      submittedAt?: string | null;
      textAnswer?: string | null;
      attachments?: unknown[] | null;
      fileUrl?: string | null;
    } & Record<string, unknown>)
  | null
  | undefined;

/** Error yang pesannya memang ditulis untuk dibaca siswa apa adanya. */
export function userError(message: string, code = 'app/invalid'): Error {
  return Object.assign(new Error(message), { userFacing: true, code });
}

/**
 * Apakah SISWA benar-benar pernah mengumpulkan sesuatu — bukan sekadar
 * "ada dokumen submission".
 *
 * Bedanya penting: guru yang menilai/memberi catatan juga menulis ke
 * dokumen yang sama. Dokumen yang isinya cuma nilai/catatan guru BUKAN
 * pengumpulan siswa, dan tidak boleh dihitung sebagai sudah mengumpulkan.
 */
export function hasStudentSubmitted(submission: SubmissionLike): boolean {
  if (!submission) return false;
  if (submission.submittedAt) return true;
  if (typeof submission.textAnswer === 'string' && submission.textAnswer.trim() !== '') return true;
  if (Array.isArray(submission.attachments) && submission.attachments.length > 0) return true;
  return !!submission.fileUrl;
}

/**
 * Status yang benar-benar berlaku untuk sebuah dokumen submission.
 *
 * Field `status` di dokumen TIDAK dipercaya sendirian: data lama sempat
 * ditandai 'dinilai' oleh guru untuk siswa yang belum mengumpulkan apa
 * pun, dan tanda itulah yang mengunci siswa dari tombol Kumpulkan
 * selamanya. Di sini status dihitung ulang dari isi dokumennya, sehingga
 * data lama yang terlanjur salah ikut sembuh tanpa migrasi.
 */
export function effectiveSubmissionStatus(submission: SubmissionLike): string {
  if (!hasStudentSubmitted(submission)) return SUBMISSION_STATUS.BELUM_MENGUMPULKAN;
  return submission?.status === SUBMISSION_STATUS.DINILAI
    ? SUBMISSION_STATUS.DINILAI
    : SUBMISSION_STATUS.MENUNGGU_PENILAIAN;
}

/**
 * Tenggat dihormati sampai HABIS hari itu (waktu WITA), bukan sampai jam
 * 00.00-nya: "Tenggat 2026-12-31" dibaca guru dan siswa sebagai "boleh
 * dikumpulkan sepanjang tanggal 31", jadi itu yang diberlakukan.
 *
 * dueDate kosong = tugas tanpa tenggat, selalu terbuka.
 */
export function isPastDue(dueDate?: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  return getWitaDateString(now) > dueDate;
}

export type StudentSubmitGate =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Satu-satunya tempat yang memutuskan boleh/tidaknya siswa mengumpulkan.
 * Dipakai UI (untuk menampilkan CTA yang benar) DAN service (sebagai
 * penjaga sebenarnya) supaya keduanya tidak pernah berbeda pendapat.
 */
export function canStudentSubmit(
  submission: SubmissionLike,
  dueDate?: string | null,
  now: Date = new Date()
): StudentSubmitGate {
  if (effectiveSubmissionStatus(submission) === SUBMISSION_STATUS.DINILAI) {
    return {
      allowed: false,
      reason: 'Tugas ini sudah dinilai gurumu, jadi jawabannya tidak bisa diubah lagi.',
    };
  }
  if (isPastDue(dueDate, now)) {
    return { allowed: false, reason: 'Tugas sudah melewati batas pengumpulan.' };
  }
  return { allowed: true };
}

const ERROR_MESSAGE_BY_CODE: Record<string, string> = {
  'permission-denied':
    'Pengumpulan ditolak server. Coba muat ulang halaman — kemungkinan gurumu sudah menilai tugas ini.',
  unauthenticated: 'Sesimu sudah berakhir. Masuk lagi memakai kode akses dari gurumu.',
  unavailable: 'Pengumpulan tugas gagal. Periksa koneksi internetmu lalu coba lagi.',
  'deadline-exceeded': 'Pengumpulan tugas gagal. Periksa koneksi internetmu lalu coba lagi.',
  cancelled: 'Pengumpulan tugas terhenti di tengah jalan. Coba kirim lagi.',
  internal: 'Pengumpulan tugas gagal. Periksa koneksi internetmu lalu coba lagi.',
  'storage/unauthorized':
    'Lampiranmu ditolak server. Pastikan filenya berupa foto, PDF, atau dokumen Word.',
  'storage/quota-exceeded': 'Penyimpanan sekolah sedang penuh. Beri tahu gurumu.',
  'storage/retry-limit-exceeded':
    'Unggahan lampiran gagal. Periksa koneksi internetmu lalu coba lagi.',
  'storage/canceled': 'Unggahan lampiran terhenti. Coba kirim lagi.',
  'storage/unauthenticated': 'Sesimu sudah berakhir. Masuk lagi memakai kode akses dari gurumu.',
};

const GENERIC_MESSAGE = 'Pengumpulan tugas gagal. Periksa koneksi internetmu lalu coba lagi.';

/**
 * Menerjemahkan kegagalan apa pun jadi satu kalimat yang masuk akal untuk
 * siswa. Pesan mentah SDK ("FirebaseError: Missing or insufficient
 * permissions", "DOMException", "undefined") tidak pernah sampai ke layar
 * — tapi pesan yang memang kita tulis sendiri (userFacing) dipertahankan
 * apa adanya, karena justru itu yang paling tepat menjelaskan keadaannya.
 */
export function describeSubmissionError(error: unknown): string {
  const candidate = (error ?? {}) as { userFacing?: boolean; message?: unknown; code?: unknown };
  if (candidate.userFacing && typeof candidate.message === 'string' && candidate.message.trim()) {
    return candidate.message;
  }
  const code = String(candidate.code ?? '').toLowerCase();
  if (code && ERROR_MESSAGE_BY_CODE[code]) return ERROR_MESSAGE_BY_CODE[code];
  return GENERIC_MESSAGE;
}
