import * as dataArchiveRepository from '../repositories/dataArchiveRepository';
import * as dataCleanupRepository from '../repositories/dataCleanupRepository';
import { DATA_LIFECYCLE_COLLECTIONS } from '../config/dataLifecycleCollections';
import { DateRange } from '../utils/periodRange';

const VALID_KEYS = DATA_LIFECYCLE_COLLECTIONS.map((c) => c.key);

function assertValidKeys(dataTypeKeys: string[]) {
  if (!dataTypeKeys || dataTypeKeys.length === 0) {
    throw new Error('Pilih minimal satu jenis data untuk dibersihkan.');
  }
  const invalid = dataTypeKeys.filter((k) => !VALID_KEYS.includes(k));
  if (invalid.length > 0) {
    throw new Error(`Jenis data tidak dikenal: ${invalid.join(', ')}.`);
  }
}

export async function previewCleanup(
  workspaceId: string,
  dataTypeKeys: string[],
  range: DateRange,
  className?: string
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  assertValidKeys(dataTypeKeys);
  if (!range.startDate && !range.endDate) {
    // Cleanup TIDAK boleh punya opsi "semua data tanpa batas periode" —
    // beda dari Download (yang boleh export semua data). Ini pengaman
    // supaya guru tidak tidak sengaja menghapus seluruh riwayat kelas.
    throw new Error('Cleanup wajib punya rentang periode — pilih periode tertentu, bukan "Semua Data".');
  }
  const counts = await dataArchiveRepository.countLifecycleData(workspaceId, range, className);
  const selected: Record<string, number> = {};
  let total = 0;
  dataTypeKeys.forEach((key) => {
    selected[key] = counts[key] || 0;
    total += counts[key] || 0;
  });
  return { counts: selected, total };
}

// Dipanggil HANYA setelah guru mengetik konfirmasi kuat di UI (mis. "HAPUS")
// — layer ini sendiri tidak menegakkan konfirmasi (itu tanggung jawab UI,
// sama seperti ConfirmDeleteModal yang sudah ada), tapi tetap validasi ulang
// input di sini karena controller/service tidak boleh percaya begitu saja
// pada state UI.
export async function executeCleanup(
  workspaceId: string,
  dataTypeKeys: string[],
  range: DateRange,
  className?: string
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  assertValidKeys(dataTypeKeys);
  if (!range.startDate && !range.endDate) {
    throw new Error('Cleanup wajib punya rentang periode — pilih periode tertentu, bukan "Semua Data".');
  }

  const deletedCounts: Record<string, number> = {};
  for (const key of dataTypeKeys) {
    deletedCounts[key] = await dataCleanupRepository.deleteLifecycleData(key, workspaceId, range, className);
  }
  return deletedCounts;
}
