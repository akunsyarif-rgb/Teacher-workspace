import * as recycleBinService from '../services/recycleBinService';
import { clearAllCached } from '../utils/sessionCache';
import type { BinItem, BinViewer, RecycleBinData } from '../services/recycleBinService';

export type { BinItem, BinKind, BinViewer, RecycleBinData } from '../services/recycleBinService';
export { canRestoreItem, canPurge, describePurgeScope } from '../services/recycleBinService';
export type { PurgeSummary } from '../services/recycleBinService';

export async function fetchRecycleBin(workspaceId: string, viewer: BinViewer): Promise<RecycleBinData> {
  return recycleBinService.loadRecycleBin(workspaceId, viewer);
}

// Pesan yang ramah untuk galat umum (izin Firestore). Pesan dari server (batas paket, izin) sudah
// berbahasa Indonesia dan dipertahankan apa adanya.
function friendlyRestoreError(error: unknown): Error {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'permission-denied') {
    return new Error('Anda tidak punya izin memulihkan item ini. Hanya pembuatnya atau pemilik/admin workspace yang bisa.');
  }
  return error instanceof Error ? error : new Error('Gagal memulihkan. Coba lagi.');
}

export async function restoreItem(item: BinItem, viewer: BinViewer) {
  try {
    const result = await recycleBinService.restoreBinItem(item, viewer);
    clearAllCached(); // daftar kelas/siswa/tugas/nilai yang ter-cache sudah basi
    return result;
  } catch (error) {
    throw friendlyRestoreError(error);
  }
}

// Hapus permanen (OWNER/ADMIN). Pesan dari server (izin, penyimpanan lampiran gagal, dst.) sudah berbahasa
// Indonesia dan dipertahankan apa adanya.
export async function purgeItem(item: BinItem, viewer: BinViewer) {
  const summary = await recycleBinService.purgeBinItem(item, viewer);
  clearAllCached();
  return summary;
}

export async function emptyBin(viewer: BinViewer) {
  const summary = await recycleBinService.emptyBin(viewer);
  clearAllCached();
  return summary;
}
