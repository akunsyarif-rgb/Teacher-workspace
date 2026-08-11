import { batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { getLifecycleCollection } from '../config/dataLifecycleCollections';
import { listLifecycleData } from './dataArchiveRepository';
import { DateRange } from '../utils/periodRange';

// Hapus SEMUA dokumen yang cocok — dipanggil hanya setelah guru
// mengonfirmasi lewat dataCleanupService. Pakai daftar dokumen yang PERSIS
// sama dengan yang dihitung listLifecycleData (dataArchiveRepository),
// supaya angka preview yang dilihat guru selalu sama dengan yang benar-benar
// terhapus — tidak ada query terpisah yang bisa diam-diam berbeda hasil.
export async function deleteLifecycleData(
  collectionKey: string,
  workspaceId: string,
  range: DateRange,
  className?: string
): Promise<number> {
  const config = getLifecycleCollection(collectionKey);
  if (!config) return 0;
  const docs = await listLifecycleData(collectionKey, workspaceId, range, className);
  if (docs.length === 0) return 0;

  const operations: BatchOperation[] = docs.map((doc: any) => ({
    type: 'delete',
    collectionName: config.collectionName,
    id: doc.id,
  }));
  await batchWrite(operations);
  return docs.length;
}
