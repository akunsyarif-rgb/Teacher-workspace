import { auth, storage } from '@/src/config/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { userError } from '../utils/submissionRules';
import {
  MAX_SUBMISSION_FILES,
  MAX_UPLOAD_BYTES,
  resolveUploadContentType,
} from '../utils/uploadFileTypes';

// Di-re-export supaya pemanggil lama (halaman siswa, AssignmentFormModal)
// tetap mengimpornya dari adapter ini seperti sebelumnya.
export { MAX_SUBMISSION_FILES, MAX_UPLOAD_BYTES, resolveUploadContentType };

// Divalidasi dua kali (di sini dan di storage.rules) bukan karena kurang
// percaya, tapi supaya siswa dapat pesan yang jelas sebelum file 10MB
// terlanjur terkirim — rules-nya sendiri tetap jadi penentu akhir.
export function validateUploadFile(file: File) {
  if (file.size >= MAX_UPLOAD_BYTES) {
    throw userError('Ukuran file maksimal 10 MB. Kecilkan dulu fotonya lalu coba lagi.');
  }
  if (!resolveUploadContentType(file)) {
    throw userError('Format file harus gambar, PDF, atau dokumen Word.');
  }
}

// Nama file dari HP bisa mengandung spasi, tanda baca, bahkan '/' yang
// akan memecah path Storage jadi folder tak terduga.
function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'lampiran';
}

export { uploadSubmissionFile, uploadSubmissionFiles } from './supabaseSubmissionStorage';

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
  if (!uid) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');

  const fileName = sanitizeFileName(file.name);
  const path = `assignment-materials/${workspaceId}/${assignmentId}/${uid}/${fileName}`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, file, { contentType: resolveUploadContentType(file) as string });
  const url = await getDownloadURL(fileRef);

  return { materialFileUrl: url, materialFileName: file.name, materialFilePath: path };
}
