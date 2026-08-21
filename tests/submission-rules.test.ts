import { describe, it, expect } from 'vitest';
import {
  canStudentSubmit,
  describeSubmissionError,
  effectiveSubmissionStatus,
  hasStudentSubmitted,
  isPastDue,
  userError,
} from '../lib/utils/submissionRules';
import { resolveUploadContentType } from '../lib/utils/uploadFileTypes';
import { SUBMISSION_STATUS } from '../lib/config/constants';

// Regresi untuk bug "siswa tidak bisa mengumpulkan tugas". Penyebabnya
// bukan satu baris salah, melainkan satu asumsi salah: "ada dokumen
// submission" dianggap sama dengan "siswa sudah mengumpulkan". Guru yang
// mengisi nilai untuk siswa yang belum mengumpulkan ikut membuat dokumen
// itu, statusnya dipaksa 'dinilai', dan sejak saat itu tombol Kumpulkan
// hilang dari layar siswa DAN rules ikut menolak tulisannya.

describe('hasStudentSubmitted — dokumen bernilai bukan berarti sudah mengumpulkan', () => {
  it('menganggap belum mengumpulkan kalau dokumennya tidak ada', () => {
    expect(hasStudentSubmitted(null)).toBe(false);
    expect(hasStudentSubmitted(undefined)).toBe(false);
  });

  it('menganggap BELUM mengumpulkan untuk dokumen yang cuma berisi nilai/catatan guru', () => {
    expect(hasStudentSubmitted({ status: 'dinilai', feedback: 'perbaiki ya' })).toBe(false);
  });

  it('menganggap sudah mengumpulkan kalau ada jawaban teks', () => {
    expect(hasStudentSubmitted({ textAnswer: 'jawaban saya' })).toBe(true);
  });

  it('tidak terkecoh jawaban teks yang cuma spasi', () => {
    expect(hasStudentSubmitted({ textAnswer: '   ' })).toBe(false);
  });

  it('menganggap sudah mengumpulkan kalau ada lampiran', () => {
    expect(hasStudentSubmitted({ attachments: [{ fileUrl: 'x', fileName: 'a.png' }] })).toBe(true);
  });

  it('mengenali lampiran bentuk lama (fileUrl tunggal)', () => {
    expect(hasStudentSubmitted({ fileUrl: 'https://contoh/x.png' })).toBe(true);
  });

  it('menganggap sudah mengumpulkan kalau ada submittedAt', () => {
    expect(hasStudentSubmitted({ submittedAt: '2026-08-20T01:00:00.000Z' })).toBe(true);
  });
});

describe('effectiveSubmissionStatus — menyembuhkan data lama yang terlanjur salah', () => {
  it('mengembalikan belum_mengumpulkan untuk dokumen "dinilai" tanpa pekerjaan siswa', () => {
    expect(effectiveSubmissionStatus({ status: 'dinilai' })).toBe(SUBMISSION_STATUS.BELUM_MENGUMPULKAN);
  });

  it('tetap dinilai kalau siswanya memang mengumpulkan lalu dinilai', () => {
    expect(effectiveSubmissionStatus({ status: 'dinilai', textAnswer: 'jawaban' })).toBe(
      SUBMISSION_STATUS.DINILAI
    );
  });

  it('menunggu penilaian untuk pengumpulan yang belum dinilai', () => {
    expect(effectiveSubmissionStatus({ status: 'menunggu_penilaian', textAnswer: 'jawaban' })).toBe(
      SUBMISSION_STATUS.MENUNGGU_PENILAIAN
    );
  });
});

describe('isPastDue — tenggat dihormati sampai habis hari itu (WITA)', () => {
  // 2026-08-20T20:00:00Z = 2026-08-21 pukul 04.00 WITA.
  const malamSebelumnya = new Date('2026-08-20T20:00:00.000Z');

  it('belum lewat pada hari tenggatnya sendiri', () => {
    expect(isPastDue('2026-08-21', malamSebelumnya)).toBe(false);
  });

  it('sudah lewat sehari sesudahnya', () => {
    expect(isPastDue('2026-08-20', malamSebelumnya)).toBe(true);
  });

  it('tugas tanpa tenggat selalu terbuka', () => {
    expect(isPastDue('', malamSebelumnya)).toBe(false);
    expect(isPastDue(null, malamSebelumnya)).toBe(false);
  });

  it('tanggal berformat aneh tidak pernah menutup pengumpulan diam-diam', () => {
    expect(isPastDue('besok', malamSebelumnya)).toBe(false);
  });
});

describe('canStudentSubmit — satu aturan untuk UI dan service', () => {
  const now = new Date('2026-08-20T20:00:00.000Z'); // 21 Agu 2026 WITA

  it('mengizinkan siswa yang belum pernah mengumpulkan', () => {
    expect(canStudentSubmit(null, '2026-12-31', now)).toEqual({ allowed: true });
  });

  it('mengizinkan perbaikan selama belum dinilai', () => {
    expect(canStudentSubmit({ status: 'menunggu_penilaian', textAnswer: 'a' }, '2026-12-31', now)).toEqual({
      allowed: true,
    });
  });

  it('TETAP mengizinkan kalau dokumennya ditandai dinilai tapi siswanya belum mengirim apa pun', () => {
    expect(canStudentSubmit({ status: 'dinilai' }, '2026-12-31', now)).toEqual({ allowed: true });
  });

  it('menolak kalau pekerjaannya sudah dikirim DAN sudah dinilai', () => {
    const gate = canStudentSubmit({ status: 'dinilai', textAnswer: 'a' }, '2026-12-31', now);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.reason).toMatch(/sudah dinilai/i);
  });

  it('menolak dengan pesan tenggat kalau sudah lewat batas', () => {
    const gate = canStudentSubmit(null, '2026-08-19', now);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.reason).toBe('Tugas sudah melewati batas pengumpulan.');
  });
});

describe('describeSubmissionError — siswa tidak pernah melihat error mentah', () => {
  it('mempertahankan pesan yang memang ditulis untuk siswa', () => {
    expect(describeSubmissionError(userError('Ukuran file maksimal 10 MB.'))).toBe(
      'Ukuran file maksimal 10 MB.'
    );
  });

  it('menerjemahkan permission-denied jadi kalimat yang bisa ditindaklanjuti', () => {
    const message = describeSubmissionError({
      code: 'permission-denied',
      message: 'FirebaseError: Missing or insufficient permissions.',
    });
    expect(message).not.toMatch(/FirebaseError|permission/i);
    expect(message).toMatch(/gurumu sudah menilai/i);
  });

  it('menerjemahkan kegagalan Storage', () => {
    expect(describeSubmissionError({ code: 'storage/unauthorized' })).toMatch(/foto, PDF, atau dokumen Word/i);
  });

  it('memberi pesan jaringan yang jelas untuk error tak dikenal', () => {
    for (const raw of [new TypeError('undefined is not an object'), new SyntaxError('Unexpected token <'), undefined]) {
      expect(describeSubmissionError(raw)).toBe(
        'Pengumpulan tugas gagal. Periksa koneksi internetmu lalu coba lagi.'
      );
    }
  });
});

describe('resolveUploadContentType — foto dari HP tidak boleh ditolak sendiri', () => {
  it('memakai tipe dari browser kalau memang sah', () => {
    expect(resolveUploadContentType({ name: 'jawaban.png', type: 'image/png' })).toBe('image/png');
  });

  it('menyimpulkan dari ekstensi kalau HP melaporkan application/octet-stream', () => {
    expect(resolveUploadContentType({ name: 'IMG_0001.jpg', type: 'application/octet-stream' })).toBe(
      'image/jpeg'
    );
  });

  it('menyimpulkan dari ekstensi kalau tipe-nya kosong', () => {
    expect(resolveUploadContentType({ name: 'tugas.pdf', type: '' })).toBe('application/pdf');
    expect(resolveUploadContentType({ name: 'tugas.docx' })).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  it('tidak peduli huruf besar/kecil pada ekstensi', () => {
    expect(resolveUploadContentType({ name: 'FOTO.JPEG', type: '' })).toBe('image/jpeg');
  });

  it('tetap menolak yang memang bukan format tugas', () => {
    expect(resolveUploadContentType({ name: 'video.mp4', type: 'video/mp4' })).toBeNull();
    expect(resolveUploadContentType({ name: 'arsip.zip', type: 'application/octet-stream' })).toBeNull();
    expect(resolveUploadContentType({ name: 'tanpa-ekstensi', type: '' })).toBeNull();
  });
});
