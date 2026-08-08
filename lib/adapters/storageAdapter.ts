import { auth, storage } from '@/src/config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Harus sejalan dengan isAllowedUpload() di storage.rules. Divalidasi dua
// kali (di sini dan di rules) bukan karena kurang percaya, tapi supaya
// siswa dapat pesan yang jelas sebelum file 10MB terlanjur terkirim —
// rules-nya sendiri tetap jadi penentu akhir.
const ALLOWED_TYPE_PATTERNS = [
  /^image\//,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
];

export function validateUploadFile(file: File) {
  if (file.size >= MAX_UPLOAD_BYTES) {
    throw new Error('Ukuran file maksimal 10 MB.');
  }
  if (!ALLOWED_TYPE_PATTERNS.some((pattern) => pattern.test(file.type))) {
    throw new Error('Format file harus gambar, PDF, atau dokumen Word.');
  }
}

// Nama file dari HP bisa mengandung spasi, tanda baca, bahkan '/' yang
// akan memecah path Storage jadi folder tak terduga.
function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'lampiran';
}

/**
 * Mengunggah lampiran jawaban tugas. Path memuat UID pengunggah karena
 * itulah yang dipakai storage.rules untuk membuktikan kepemilikan.
 */
export async function uploadSubmissionFile(
  workspaceId: string,
  assignmentId: string,
  file: File
) {
  validateUploadFile(file);

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sesi tidak valid, coba muat ulang halaman.');

  const fileName = sanitizeFileName(file.name);
  const path = `submissions/${workspaceId}/${assignmentId}/${uid}/${fileName}`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);

  return { fileUrl: url, fileName: file.name, filePath: path };
}
