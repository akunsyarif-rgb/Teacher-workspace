import { auth, storage } from '@/src/config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_SUBMISSION_FILES = 5;

// Upload lampiran lewat jaringan sekolah/seluler yang tidak stabil bisa
// diam-diam menggantung tanpa pernah resolve ATAUPUN reject (koneksi putus
// di tengah jalan tanpa sinyal apa pun ke browser) — uploadBytes() sendiri
// tidak punya batas waktu bawaan. Tanpa timeout ini, tombol kirim tetap
// berputar selamanya dan siswa tidak pernah tahu unggahannya gagal.
const UPLOAD_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), UPLOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

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
  file: File,
  // Prefix unik per file (index/timestamp) supaya beberapa foto yang
  // kebetulan bernama sama (mis. "IMG_0001.jpg" dari kamera HP) tidak
  // saling menimpa di path Storage yang sama.
  uniquePrefix?: string
) {
  validateUploadFile(file);

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sesi tidak valid, coba muat ulang halaman.');

  const fileName = sanitizeFileName(file.name);
  const path = `submissions/${workspaceId}/${assignmentId}/${uid}/${uniquePrefix ? `${uniquePrefix}_${fileName}` : fileName}`;
  const fileRef = ref(storage, path);

  await withTimeout(
    uploadBytes(fileRef, file, { contentType: file.type }),
    `Unggah "${file.name}" terlalu lama, periksa koneksi internetmu lalu coba lagi.`
  );
  const url = await withTimeout(
    getDownloadURL(fileRef),
    `Gagal mengambil tautan "${file.name}", periksa koneksi internetmu lalu coba lagi.`
  );

  return { fileUrl: url, fileName: file.name, filePath: path };
}

/**
 * Mengunggah beberapa lampiran jawaban tugas sekaligus (maks
 * MAX_SUBMISSION_FILES foto/dokumen per pengumpulan).
 */
export async function uploadSubmissionFiles(
  workspaceId: string,
  assignmentId: string,
  files: File[]
) {
  if (files.length > MAX_SUBMISSION_FILES) {
    throw new Error(`Maksimal ${MAX_SUBMISSION_FILES} file per pengumpulan.`);
  }
  return Promise.all(
    files.map((file, index) => uploadSubmissionFile(workspaceId, assignmentId, file, String(index)))
  );
}

/**
 * Mengunggah materi/lampiran tugas dari guru (bukan jawaban siswa). Path
 * memuat UID guru dengan alasan sama seperti uploadSubmissionFile: itulah
 * yang dipakai storage.rules untuk membuktikan kepemilikan tanpa perlu
 * firestore.get (terbukti tidak bisa diuji di Storage emulator).
 */
export async function uploadAssignmentFile(
  workspaceId: string,
  assignmentId: string,
  file: File
) {
  validateUploadFile(file);

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sesi tidak valid, coba muat ulang halaman.');

  const fileName = sanitizeFileName(file.name);
  const path = `assignment-materials/${workspaceId}/${assignmentId}/${uid}/${fileName}`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);

  return { materialFileUrl: url, materialFileName: file.name, materialFilePath: path };
}
