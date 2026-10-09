import { auth } from '@/src/config/firebase';
import { MAX_SUBMISSION_FILES, MAX_UPLOAD_BYTES, resolveUploadContentType } from '@/lib/utils/uploadFileTypes';
import { userError } from '@/lib/utils/submissionRules';
import { withTimeout } from '@/lib/utils/withTimeout';
import { compressImageForUpload } from '@/lib/utils/imageCompression';

const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const SUPABASE_FILE_PREFIX = 'supabase-storage://submission-attachments/';

export function isSupabaseSubmissionFile(fileUrl?: string | null) {
  return typeof fileUrl === 'string' && fileUrl.startsWith(SUPABASE_FILE_PREFIX);
}

export function submissionFilePath(fileUrl?: string | null, filePath?: string | null) {
  // filePath Firebase lama juga memakai submissions/...; hanya sentinel
  // provider yang membedakan file Supabase agar tautan lama tetap berfungsi.
  if (!isSupabaseSubmissionFile(fileUrl)) return null;
  const path = fileUrl!.slice(SUPABASE_FILE_PREFIX.length);
  if (filePath && filePath !== path) return null;
  return path;
}

export function validateSupabaseSubmissionFile(file: File) {
  if (file.size <= 0 || file.size >= MAX_UPLOAD_BYTES) throw userError('Ukuran file maksimal 10 MB. Kecilkan dulu fotonya lalu coba lagi.');
  const contentType = resolveUploadContentType(file);
  const supabaseAllowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  if (!contentType || !supabaseAllowed.has(contentType)) throw userError('Format file belum didukung oleh penyimpanan tugas. Gunakan JPG, PNG, WebP, HEIC, PDF, atau Word.');
  return contentType;
}

export async function uploadSubmissionFile(
  workspaceId: string,
  assignmentId: string,
  file: File,
  _uniquePrefix?: string
) {
  validateSupabaseSubmissionFile(file);
  // Foto dikompres di browser (maks 1600px, JPEG 80%) supaya hemat bucket;
  // file lain / gagal kompres = file asli.
  const originalType = resolveUploadContentType(file) as string;
  file = await compressImageForUpload(file, originalType);
  const contentType = validateSupabaseSubmissionFile(file);
  const user = auth.currentUser;
  if (!user) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const idToken = await user.getIdToken();
    let response: Response;
    try {
      response = await withTimeout(
        fetch('/api/submission-attachments/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ workspaceId, assignmentId, fileName: file.name, fileSize: file.size, contentType }),
          signal: controller.signal,
          cache: 'no-store',
        }),
        'Menyiapkan unggahan terlalu lama. Periksa koneksi internetmu lalu coba lagi.',
        UPLOAD_TIMEOUT_MS
      );
    } catch (error) {
      if ((error as { userFacing?: boolean })?.userFacing || (error as Error)?.name === 'AbortError') throw error;
      console.error('Gagal menghubungi server untuk menyiapkan unggahan:', error);
      throw userError('Tidak bisa terhubung ke server aplikasi (langkah 1). Periksa koneksi lalu coba lagi.');
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw userError(result.error || 'Foto belum berhasil disiapkan untuk diunggah.');
    if (!result.signedUrl || !result.path || !result.token) {
      throw userError('Server tidak mengembalikan izin unggah sementara yang lengkap.');
    }

    // File dikirim langsung ke Supabase, bukan lewat Vercel Function, supaya
    // foto di bawah batas bucket (10 MB) tidak terhalang batas payload server.
    // Format sama dengan uploadToSignedUrl milik supabase-js (multipart);
    // Blob dibuat ulang dengan contentType hasil resolve supaya foto dari HP
    // yang tipenya kosong/octet-stream tetap lolos pemeriksaan MIME bucket.
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', new Blob([file], { type: contentType }), file.name);
    let uploadResponse: Response;
    try {
      uploadResponse = await withTimeout(
        fetch(result.signedUrl, {
          method: 'PUT',
          headers: { 'x-upsert': 'false' },
          body: form,
          signal: controller.signal,
          cache: 'no-store',
        }),
        `Unggah "${file.name}" terlalu lama. Periksa koneksi internetmu lalu coba lagi.`,
        UPLOAD_TIMEOUT_MS
      );
    } catch (error) {
      if ((error as { userFacing?: boolean })?.userFacing || (error as Error)?.name === 'AbortError') throw error;
      console.error('Gagal mengirim file ke penyimpanan Supabase:', error);
      throw userError('Tidak bisa terhubung ke penyimpanan lampiran (langkah 2). Periksa koneksi lalu coba lagi.');
    }
    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text().catch(() => '');
      console.error('Supabase signed upload failed:', uploadResponse.status, detail);
      throw userError(`Foto belum berhasil disimpan (kode ${uploadResponse.status}). Coba lagi setelah koneksi stabil.`);
    }

    return {
      fileUrl: `supabase-storage://submission-attachments/${result.path}`,
      fileName: file.name,
      filePath: result.path as string,
    };
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
 * URL yang bisa dipakai browser untuk lampiran: signed URL 5 menit untuk
 * file Supabase privat, atau URL Firebase lama apa adanya.
 */
export async function resolveSubmissionAttachmentUrl(fileUrl?: string | null, filePath?: string | null): Promise<string> {
  const path = submissionFilePath(fileUrl, filePath);
  if (!path) {
    if (!fileUrl) throw userError('Lampiran tidak ditemukan.');
    return fileUrl;
  }
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
    throw userError(result.error || 'Lampiran belum bisa dibuka. Coba lagi.');
  }
  return result.signedUrl as string;
}
