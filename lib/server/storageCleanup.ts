import { ApiError } from './apiErrors';
import { ulanganAuthHeaders, ulanganSupabaseConfig } from './ulanganSupabase';
import { getAdminBucket } from './firebaseAdmin';
import { logger } from '../utils/logger';

// Penghapusan BERKAS fisik yang terkait dokumen yang dihapus permanen (Sampah).
const SUBMISSION_BUCKET = 'submission-attachments';
const SUPABASE_DELETE_CHUNK = 100;

export type FileCleanupDeps = {
  /** Hapus lampiran jawaban siswa (Supabase Storage). Melempar bila gagal. */
  deleteSubmissionFiles: (paths: string[]) => Promise<number>;
  /** Hapus materi tugas (Firebase Storage). Upaya terbaik: tidak melempar. */
  deleteMaterialFile: (path: string) => Promise<boolean>;
};

// Lampiran siswa: bila penyimpanan tidak bisa dihubungi, penghapusan DIBATALKAN (melempar) sebelum
// dokumen yang menyimpan path-nya dihapus — supaya tidak ada berkas yatim tanpa jejak. Aman diulang.
export async function deleteSubmissionFiles(
  paths: string[],
  deps: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}
): Promise<number> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return 0;

  let config: { url: string; key: string };
  try {
    config = ulanganSupabaseConfig(deps.env);
  } catch (error) {
    logger.error('storage_cleanup.supabase_config_invalid', { err: error });
    throw new ApiError('Penyimpanan lampiran belum dikonfigurasi di server ini, sehingga lampiran belum bisa dihapus. Hubungi admin.', 503);
  }

  for (let i = 0; i < unique.length; i += SUPABASE_DELETE_CHUNK) {
    const prefixes = unique.slice(i, i + SUPABASE_DELETE_CHUNK);
    let ok = false;
    try {
      const res = await (deps.fetchImpl ?? fetch)(`${config.url}/storage/v1/object/${SUBMISSION_BUCKET}`, {
        method: 'DELETE',
        headers: ulanganAuthHeaders(config.key),
        body: JSON.stringify({ prefixes }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      ok = res.ok;
      if (!ok) logger.error('storage_cleanup.supabase_delete_failed', { upstreamStatus: res.status, detail: await res.text().catch(() => '') });
    } catch (error) {
      logger.error('storage_cleanup.supabase_unreachable', { err: error });
    }
    if (!ok) throw new ApiError('Lampiran siswa belum bisa dihapus dari penyimpanan. Tidak ada data yang dihapus untuk bagian ini; coba lagi.', 502);
  }
  return unique.length;
}

export async function deleteMaterialFile(path: string): Promise<boolean> {
  try {
    await getAdminBucket().file(path).delete({ ignoreNotFound: true });
    return true;
  } catch (error) {
    // Materi tugas dari guru bukan data pribadi siswa dan penyimpanannya bisa saja tidak diaktifkan;
    // kegagalan dicatat tetapi tidak membatalkan penghapusan dokumen.
    logger.warn('storage_cleanup.material_delete_failed', { err: error });
    return false;
  }
}

export const defaultFileCleanup: FileCleanupDeps = { deleteSubmissionFiles, deleteMaterialFile };
