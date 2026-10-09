import { auth } from '@/src/config/firebase';
import { validateUploadFile, MAX_SUBMISSION_FILES } from '@/lib/adapters/storageAdapter';
import { userError } from '@/lib/utils/submissionRules';
import { withTimeout } from '@/lib/utils/withTimeout';

const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const SUPABASE_FILE_PREFIX = 'supabase-storage://submission-attachments/';

export function isSupabaseSubmissionFile(fileUrl?: string | null) {
  return typeof fileUrl === 'string' && fileUrl.startsWith(SUPABASE_FILE_PREFIX);
}

export function submissionFilePath(fileUrl?: string | null, filePath?: string | null) {
  if (filePath && filePath.startsWith('submissions/')) return filePath;
  if (!isSupabaseSubmissionFile(fileUrl)) return null;
  return fileUrl!.slice(SUPABASE_FILE_PREFIX.length);
}

export async function uploadSubmissionFile(
  workspaceId: string,
  assignmentId: string,
  file: File,
  _uniquePrefix?: string
) {
  validateUploadFile(file);
  const user = auth.currentUser;
  if (!user) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const idToken = await user.getIdToken();
    const form = new FormData();
    form.set('workspaceId', workspaceId);
    form.set('assignmentId', assignmentId);
    form.set('file', file, file.name);

    const request = fetch('/api/submission-attachments/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
    const response = await withTimeout(
      request,
      `Unggah "${file.name}" terlalu lama. Periksa koneksi internetmu lalu coba lagi.`,
      UPLOAD_TIMEOUT_MS
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw userError(result.error || 'Foto belum berhasil diunggah. Coba lagi.');
    }
    if (!result.fileUrl || !result.filePath) {
      throw userError('Server tidak mengembalikan data lampiran yang lengkap.');
    }
    return { fileUrl: result.fileUrl as string, fileName: result.fileName || file.name, filePath: result.filePath as string };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw userError(`Unggah "${file.name}" terlalu lama. Periksa koneksi internetmu lalu coba lagi.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadSubmissionFiles(workspaceId: string, assignmentId: string, files: File[]) {
  if (files.length > MAX_SUBMISSION_FILES) {
    throw userError(`Maksimal ${MAX_SUBMISSION_FILES} file per pengumpulan.`);
  }
  return Promise.all(files.map((file, index) => uploadSubmissionFile(workspaceId, assignmentId, file, String(index))));
}

/**
 * Membuka lampiran Supabase privat melalui URL bertanda tangan berumur 5 menit.
 * URL Firebase lama tetap dibuka seperti biasa agar lampiran lama tidak rusak.
 */
export async function openSubmissionAttachment(fileUrl?: string | null, filePath?: string | null) {
  const path = submissionFilePath(fileUrl, filePath);
  if (!path) {
    if (fileUrl) window.open(fileUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  const tab = window.open('about:blank', '_blank');
  try {
    const user = auth.currentUser;
    if (!user) throw userError('Sesi tidak valid. Silakan masuk kembali.', 'unauthenticated');
    const idToken = await user.getIdToken();
    const response = await fetch('/api/submission-attachments/sign', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath: path }),
      cache: 'no-store',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.signedUrl) {
      throw new Error(result.error || 'Lampiran belum bisa dibuka. Coba lagi.');
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.signedUrl;
    } else {
      window.location.href = result.signedUrl;
    }
  } catch (error) {
    if (tab) tab.close();
    console.error('Gagal membuka lampiran:', error);
    window.alert(error instanceof Error ? error.message : 'Lampiran belum bisa dibuka. Coba lagi.');
  }
}
