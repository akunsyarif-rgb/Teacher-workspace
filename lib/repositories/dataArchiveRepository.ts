import { countDocuments, getDocuments } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';
import { DATA_LIFECYCLE_COLLECTIONS, getLifecycleCollection } from '../config/dataLifecycleCollections';
import { buildDateRangeFilters, DateRange } from '../utils/periodRange';

export type LifecycleCounts = Record<string, number>;

// Scope "per kelas" difilter DI MEMORI setelah mengambil dokumen (bukan
// query Firestore dengan filter className tambahan) — sengaja, supaya
// tidak perlu index komposit baru per kombinasi kelas (lihat komentar di
// firestore.indexes.json). Volume data satu workspace per periode wajar
// untuk pendekatan ini; kalau workspace makin besar, index khusus bisa
// ditambah nanti tanpa mengubah bentuk fungsi ini.
async function fetchLifecycleDocs(collectionKey: string, workspaceId: string, range: DateRange, className?: string) {
  const config = getLifecycleCollection(collectionKey);
  if (!config || !workspaceId) return [];
  const filters: [string, any, any][] = [
    ['workspaceId', '==', workspaceId],
    ...buildDateRangeFilters(config.dateField, config.dateFormat, range),
  ];
  const docs = await getDocuments(config.collectionName, filters);
  if (!className) return docs;
  return docs.filter((d: any) => d.className === className);
}

export async function countLifecycleData(
  workspaceId: string,
  range: DateRange,
  className?: string
): Promise<LifecycleCounts> {
  const counts: LifecycleCounts = {};
  await Promise.all(
    DATA_LIFECYCLE_COLLECTIONS.map(async (config) => {
      const docs = await fetchLifecycleDocs(config.key, workspaceId, range, className);
      counts[config.key] = docs.length;
    })
  );
  return counts;
}

export async function listLifecycleData(
  collectionKey: string,
  workspaceId: string,
  range: DateRange,
  className?: string
) {
  return fetchLifecycleDocs(collectionKey, workspaceId, range, className);
}

// Total siswa & jumlah kelas — ditampilkan sebagai konteks di Arsip
// (bukan bagian dari lifecycle/periode, roster tidak diarsipkan/dihapus
// per periode sesuai keputusan "roster diurus manual oleh guru").
export async function countStudentsInWorkspace(workspaceId: string): Promise<number> {
  if (!workspaceId) return 0;
  return countDocuments(COLLECTIONS.STUDENTS, [['workspaceId', '==', workspaceId]]);
}
