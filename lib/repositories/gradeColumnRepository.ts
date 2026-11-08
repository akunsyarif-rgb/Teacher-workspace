import { getDocuments, addDocument, updateDocument, softDeleteDocument, restoreDocument } from '../adapters/firestoreAdapter';
import { activeOnly, deletedOnly } from '../utils/softDelete';
import { COLLECTIONS, DEFAULT_GRADE_COLUMNS } from '../config/constants';

async function fetchColumns(workspaceId: string, className: string) {
  return getDocuments(COLLECTIONS.GRADE_COLUMNS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

export async function getDeletedColumnsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return deletedOnly(await fetchColumns(workspaceId, className));
}

export async function getColumnsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const columns = activeOnly(await fetchColumns(workspaceId, className));
  // Tanpa orderBy, Firestore mengembalikan dokumen urut ID acak — kolom
  // nilai jadi berpindah-pindah posisi dan "perkembangan nilai" di grafik
  // siswa tidak berarti apa-apa. Diurutkan sesuai waktu kolom dibuat, yang
  // mendekati urutan asesmen sepanjang semester.
  return columns.sort((a: any, b: any) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

// createdAt bisa berupa Timestamp Firestore, atau null sesaat setelah
// ditulis (serverTimestamp belum terisi saat masih di cache lokal).
function toMillis(createdAt: any): number {
  if (!createdAt) return 0;
  if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
  if (typeof createdAt.seconds === 'number') return createdAt.seconds * 1000;
  return 0;
}

export async function createColumn(data: Record<string, any>) {
  return addDocument(COLLECTIONS.GRADE_COLUMNS, data);
}

export async function updateColumnTitle(id: string, title: string) {
  return updateDocument(COLLECTIONS.GRADE_COLUMNS, id, { title });
}

// Soft delete kolom: nilai di kolom itu (koleksi grades) ikut tersembunyi karena
// tabel nilai dibangun dari kolom aktif, dan kembali utuh saat kolom dipulihkan.
export async function deleteColumn(id: string) {
  return softDeleteDocument(COLLECTIONS.GRADE_COLUMNS, id);
}

export async function restoreColumn(id: string) {
  return restoreDocument(COLLECTIONS.GRADE_COLUMNS, id);
}

export async function createDefaultColumns(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const created = [];
  for (const col of DEFAULT_GRADE_COLUMNS) {
    const result = await createColumn({ workspaceId, className, title: col.title, type: col.type });
    created.push(result);
  }
  return created;
}
