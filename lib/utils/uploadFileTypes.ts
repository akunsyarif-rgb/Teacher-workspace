/**
 * Aturan tipe berkas yang boleh diunggah — murni, tanpa menyentuh Firebase,
 * supaya bisa diuji apa adanya (storageAdapter mengimpor konfigurasi
 * Firebase, jadi tidak bisa dimuat di test unit).
 *
 * Harus sejalan dengan isAllowedUpload() di storage.rules.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_SUBMISSION_FILES = 5;

const ALLOWED_TYPE_PATTERNS = [
  /^image\//,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
];

// Tipe berkas menurut EKSTENSI, dipakai kalau browser tidak memberi tipe
// yang berguna. Ini bukan kelonggaran keamanan: hasilnya tetap harus
// termasuk daftar yang sama seperti di storage.rules — yang berubah cuma
// dari mana tipe itu diketahui.
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Tipe berkas yang akan dikirim ke Storage, atau null kalau memang tidak
 * termasuk yang diizinkan.
 *
 * Kenapa tidak cukup memakai `file.type`: aplikasi berkas bawaan Android,
 * Google Drive, dan berbagi dari aplikasi chat sering melaporkan foto
 * sebagai `application/octet-stream` atau string kosong. Sebelum ini, foto
 * pekerjaan tulis tangan — cara paling umum siswa mengumpulkan tugas —
 * ditolak mentah-mentah di HP sendiri dengan pesan "Format file harus
 * gambar, PDF, atau dokumen Word", dan siswa tidak punya jalan lain.
 * Kalau tipenya tidak berguna, tipe sebenarnya disimpulkan dari ekstensi
 * nama berkas lalu dikirim eksplisit ke uploadBytes, sehingga storage.rules
 * tetap melihat contentType yang sah TANPA aturannya dilonggarkan sedikit
 * pun.
 */
export function resolveUploadContentType(file: { name: string; type?: string }): string | null {
  const reported = (file.type || '').toLowerCase().trim();
  if (ALLOWED_TYPE_PATTERNS.some((pattern) => pattern.test(reported))) return reported;

  const extension = (file.name || '').toLowerCase().split('.').pop() || '';
  return CONTENT_TYPE_BY_EXTENSION[extension] || null;
}
