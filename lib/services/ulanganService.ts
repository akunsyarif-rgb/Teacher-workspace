import * as repo from '../repositories/ulanganRepository';
import type { ExamInput } from '../types/ulangan';
import { INTEGRITY_LEAVE_THRESHOLD_MS } from '../config/ulangan';

// Validasi di sini hanya untuk UX (pesan cepat). Server memvalidasi ulang SEMUANYA dan tidak mempercayai klien.
export function validateExamInput(e: ExamInput): string | null {
  if (!e.title.trim()) return 'Judul ulangan wajib diisi.';
  if (!Number.isInteger(e.durationMinutes) || e.durationMinutes < 1 || e.durationMinutes > 300) return 'Durasi 1–300 menit.';
  const o = Date.parse(e.opensAt);
  const c = Date.parse(e.closesAt);
  if (Number.isNaN(o) || Number.isNaN(c)) return 'Jadwal buka/tutup wajib diisi.';
  if (c <= o) return 'Waktu tutup harus setelah waktu buka.';
  if (e.classNames.length === 0) return 'Pilih minimal satu kelas.';
  if (e.questions.length === 0) return 'Tambahkan minimal 1 soal.';
  if (e.questions.length > 100) return 'Maksimal 100 soal per ulangan.';
  for (const [i, q] of e.questions.entries()) {
    const n = i + 1;
    if (!q.body.trim()) return `Soal ${n}: teks soal kosong.`;
    const opts = q.options.map((x) => x.trim());
    if (opts.length < 2 || opts.length > 6) return `Soal ${n}: harus punya 2–6 pilihan.`;
    if (opts.some((x) => !x)) return `Soal ${n}: ada pilihan yang kosong.`;
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= opts.length) return `Soal ${n}: pilih kunci jawaban.`;
  }
  return null;
}

export async function saveExam(e: ExamInput) {
  const err = validateExamInput(e);
  if (err) throw new Error(err);
  return repo.saveExam({ ...e, title: e.title.trim(), subject: e.subject.trim() });
}

// Pesan galat server → bahasa pengguna. Kode dari RPC (lihat migrasi 20261010000000).
const ERRORS: [RegExp, string][] = [
  [/attempt_expired/, 'Waktu ujian sudah habis.'],
  [/attempt_not_active/, 'Ujian sudah selesai.'],
  [/exam_not_open/, 'Ulangan belum dibuka atau sudah ditutup.'],
  [/exam_not_available|attempt_not_found|exam_not_found/, 'Ulangan tidak tersedia untukmu.'],
  [/exam_locked/, 'Ulangan yang sudah diterbitkan tidak bisa diubah.'],
  [/exam_needs_questions/, 'Ulangan belum punya soal.'],
  [/not_logged_in/, 'Silakan masuk kembali.'],
  [/class_not_found/, 'Kelas tidak ditemukan di workspace ini.'],
  [/schedule_in_past/, 'Jadwal tutup sudah lewat.'],
  [/not_a_teacher|not_a_student|forbidden|42501|denied/, 'Tidak berwenang untuk tindakan ini.'],
  [/invalid_|http_501/, 'Data tidak valid atau fitur belum aktif.'],
  [/offline|network|timeout/, 'Koneksi bermasalah. Coba lagi.'],
];
export function describeUlanganError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return ERRORS.find(([re]) => re.test(msg))?.[1] ?? 'Terjadi kesalahan. Coba lagi.';
}

// Peringatan bertingkat untuk siswa. Hanya informasi; tidak ada sanksi otomatis.
export function integrityWarningText(level: number): string {
  if (level >= 3) return 'Peringatan 3: kamu berulang kali meninggalkan halaman ujian. Kejadian ini tercatat dan akan ditinjau gurumu.';
  if (level === 2) return 'Peringatan 2: kamu meninggalkan halaman ujian lagi. Tetap di halaman ini sampai selesai.';
  return 'Peringatan 1: kamu meninggalkan halaman ujian. Aktivitas ini tercatat dan dapat ditinjau gurumu.';
}
export const shouldReportLeave = (durationMs: number) => durationMs > INTEGRITY_LEAVE_THRESHOLD_MS;

// seq monoton per sesi browser agar autosave yang tiba terlambat tidak menimpa jawaban lebih baru.
let lastSeq = 0;
export function nextClientSeq(now: number = Date.now()): number {
  lastSeq = Math.max(lastSeq + 1, now);
  return lastSeq;
}
