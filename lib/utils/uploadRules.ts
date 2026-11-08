// Aturan unggah lampiran tugas, ditegakkan SERVER sebelum tiket upload
// ditandatangani (app/api/submission-attachments/upload). Nilai dari client
// (contentType, fileSize, fileName) tidak dipercaya: dicocokkan dengan allowlist
// ketat di sini, dan bucket Supabase menegakkan batas yang sama pada byte
// sebenarnya (supabase/migrations/20261108000000_harden_submission_bucket.sql).
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_SUBMISSION = 10;
export const MAX_FILENAME_LENGTH = 200;

// MIME -> ekstensi nama berkas yang sah. Tipe DAN ekstensi harus cocok:
// mencegah "x.html" diunggah dengan Content-Type image/png.
export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif', 'heic'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
};

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toLowerCase() : '';
}

export type UploadCheck = { ok: true } | { ok: false; status: 413 | 415; error: string };

export function validateUploadRequest(input: { fileName: string; contentType: unknown; fileSize: number }): UploadCheck {
  const { fileName, contentType, fileSize } = input;
  if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize >= MAX_FILE_BYTES) {
    return { ok: false, status: 413, error: 'Ukuran file harus kurang dari 10 MB.' };
  }
  // contentType harus persis salah satu kunci allowlist (tanpa parameter seperti "; charset").
  const allowedExtensions = typeof contentType === 'string' && Object.hasOwn(ALLOWED_UPLOAD_TYPES, contentType)
    ? ALLOWED_UPLOAD_TYPES[contentType]
    : undefined;
  if (!allowedExtensions) {
    return { ok: false, status: 415, error: 'Format file harus gambar, PDF, atau dokumen Word.' };
  }
  if (fileName.length > MAX_FILENAME_LENGTH || !allowedExtensions.includes(fileExtension(fileName))) {
    return { ok: false, status: 415, error: 'Nama atau ekstensi file tidak sesuai dengan jenis file.' };
  }
  return { ok: true };
}
