import { auth } from '@/src/config/firebase';
import { userError } from '../utils/submissionRules';
import { resolveUploadContentType } from '../utils/uploadFileTypes';

// Jalur upload ALTERNATIF: mengirim file ke app/api/upload, yang lalu
// mengunggahnya ke Google Drive lewat Service Account
// (lib/adapters/googleDriveAdapter.ts, server-only). Firebase Storage
// (storageAdapter.ts) tetap jalur UTAMA — ini ditambahkan sebagai pilihan
// kedua, bukan pengganti, untuk guru/siswa yang ingin filenya tersimpan
// di Google Drive sekolah.
//
// Batas ukuran lebih kecil dari Firebase Storage (4 MB, bukan 10 MB):
// Vercel Serverless Function membatasi body request ke ±4.5 MB. File
// besar TETAP harus lewat Firebase Storage (upload langsung dari client,
// tidak melalui server sama sekali) — lihat komentar yang sama di
// app/api/upload/route.ts.
export const MAX_DRIVE_UPLOAD_BYTES = 4 * 1024 * 1024;

const UPLOAD_TIMEOUT_MS = 60_000;

export function validateDriveUploadFile(file: File) {
  if (file.size >= MAX_DRIVE_UPLOAD_BYTES) {
    throw userError(
      'Ukuran file maksimal 4 MB untuk jalur Google Drive. Kecilkan dulu file-nya, atau pakai unggah foto biasa (maks 10 MB).'
    );
  }
  if (!resolveUploadContentType(file)) {
    throw userError('Format file harus gambar, PDF, atau dokumen Word.');
  }
}

export type DriveUploadResult = {
  fileUrl: string;
  fileName: string;
  fileId: string;
  provider: 'google-drive';
};

async function uploadOneToDrive(
  workspaceId: string,
  assignmentId: string,
  kind: 'submission' | 'material',
  file: File
): Promise<DriveUploadResult> {
  validateDriveUploadFile(file);

  const user = auth.currentUser;
  if (!user) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');
  const idToken = await user.getIdToken();

  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('workspaceId', workspaceId);
  formData.append('assignmentId', assignmentId);
  formData.append('kind', kind);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      body: formData,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw userError(
        `Unggah "${file.name}" ke Google Drive terlalu lama, periksa koneksi internetmu lalu coba lagi.`
      );
    }
    throw userError(`Gagal mengunggah "${file.name}" ke Google Drive, periksa koneksi internetmu lalu coba lagi.`);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => ({}) as any);
  if (!response.ok) {
    throw userError(body?.error || `Gagal mengunggah "${file.name}" ke Google Drive.`);
  }
  return {
    fileUrl: body.fileUrl,
    fileName: body.fileName || file.name,
    fileId: body.fileId,
    provider: 'google-drive',
  };
}

export async function uploadSubmissionFileToDrive(workspaceId: string, assignmentId: string, file: File) {
  return uploadOneToDrive(workspaceId, assignmentId, 'submission', file);
}

/** Mengunggah beberapa lampiran jawaban tugas ke Drive sekaligus. */
export async function uploadSubmissionFilesToDrive(workspaceId: string, assignmentId: string, files: File[]) {
  return Promise.all(files.map((file) => uploadOneToDrive(workspaceId, assignmentId, 'submission', file)));
}

export async function uploadAssignmentMaterialToDrive(workspaceId: string, assignmentId: string, file: File) {
  return uploadOneToDrive(workspaceId, assignmentId, 'material', file);
}
