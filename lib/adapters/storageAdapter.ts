import { auth } from '@/src/config/firebase';
import {
  SUPABASE_SUBMISSION_BUCKET,
  supabaseRequest,
  uploadSupabaseObject,
} from '@/src/config/supabase';
import { userError } from '../utils/submissionRules';
import {
  MAX_SUBMISSION_FILES,
  MAX_UPLOAD_BYTES,
  resolveUploadContentType,
} from '../utils/uploadFileTypes';

export { MAX_SUBMISSION_FILES, MAX_UPLOAD_BYTES, resolveUploadContentType };

const SIGNED_URL_SECONDS = 60 * 60;

export function validateUploadFile(file: File) {
  if (file.size >= MAX_UPLOAD_BYTES) {
    throw userError('Ukuran file maksimal 10 MB. Kecilkan dulu fotonya lalu coba lagi.');
  }
  if (!resolveUploadContentType(file)) {
    throw userError('Format file harus gambar, PDF, atau dokumen Word.');
  }
}

function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(-80) || 'lampiran';
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Membuat URL sementara untuk membuka file private di browser. */
export async function createAttachmentSignedUrl(path: string, expiresIn = SIGNED_URL_SECONDS) {
  const encodedPath = encodePath(path);
  const { data } = await supabaseRequest<{ signedURL?: string; signedUrl?: string }>(
    `/storage/v1/object/sign/${SUPABASE_SUBMISSION_BUCKET}/${encodedPath}`,
    {
      method: 'POST',
      body: JSON.stringify({ expiresIn }),
    }
  );
  const signedUrl = data.signedURL || data.signedUrl;
  if (!signedUrl) throw new Error('Tautan lampiran tidak dapat dibuat.');
  return signedUrl.startsWith('http') ? signedUrl : signedUrl;
}

async function uploadPrivateFile(path: string, file: File) {
  validateUploadFile(file);
  const uid = auth.currentUser?.uid;
  if (!uid) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');

  const contentType = resolveUploadContentType(file) as string;
  await uploadSupabaseObject(path, file, contentType);
  const signedUrl = await createAttachmentSignedUrl(path);
  return { fileUrl: signedUrl, fileName: file.name, filePath: path };
}

export async function uploadSubmissionFile(
  workspaceId: string,
  assignmentId: string,
  file: File,
  uniquePrefix?: string
) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');
  const fileName = sanitizeFileName(file.name);
  const path = `submissions/${workspaceId}/${assignmentId}/${uid}/${uniquePrefix ? `${uniquePrefix}_${fileName}` : fileName}`;
  return uploadPrivateFile(path, file);
}

export async function uploadSubmissionFiles(
  workspaceId: string,
  assignmentId: string,
  files: File[]
) {
  if (files.length > MAX_SUBMISSION_FILES) {
    throw userError(`Maksimal ${MAX_SUBMISSION_FILES} file per pengumpulan.`);
  }
  return Promise.all(
    files.map((file, index) => uploadSubmissionFile(workspaceId, assignmentId, file, String(index)))
  );
}

export async function uploadAssignmentFile(
  workspaceId: string,
  assignmentId: string,
  file: File
) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw userError('Sesi tidak valid, coba muat ulang halaman.', 'unauthenticated');
  const fileName = sanitizeFileName(file.name);
  const path = `assignment-materials/${workspaceId}/${assignmentId}/${uid}/${fileName}`;
  const result = await uploadPrivateFile(path, file);
  return {
    materialFileUrl: result.fileUrl,
    materialFileName: result.fileName,
    materialFilePath: result.filePath,
  };
}

export { SUPABASE_SUBMISSION_BUCKET };
