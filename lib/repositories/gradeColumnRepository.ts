import { getDocuments, getAllDocumentsPaged, addDocument, updateDocument, softDeleteDocument, restoreDocument } from '../adapters/firestoreAdapter';
import { activeOnly, deletedOnly } from '../utils/softDelete';
import type { Doc } from '../adapters/firestoreAdapter';
import type { GradeColumnData } from '../types/models';
import { COLLECTIONS, DEFAULT_GRADE_COLUMNS } from '../config/constants';

async function fetchColumns(workspaceId: string, className: string): Promise<Doc<GradeColumnData>[]> {
  return getDocuments<GradeColumnData>(COLLECTIONS.GRADE_COLUMNS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

// Seluruh kolom nilai terhapus di workspace (Sampah).
export async function getDeletedColumns(workspaceId: string): Promise<Doc<GradeColumnData>[]> {
  if (!workspaceId) return [];
  return deletedOnly(await getAllDocumentsPaged<GradeColumnData>(COLLECTIONS.GRADE_COLUMNS, [['workspaceId', '==', workspaceId]]));
}

export async function getDeletedColumnsByClass(workspaceId: string, className: string): Promise<Doc<GradeColumnData>[]> {
  if (!workspaceId || !className) return [];
  return deletedOnly(await fetchColumns(workspaceId, className));
}

export async function getColumnsByClass(workspaceId: string, className: string): Promise<Doc<GradeColumnData>[]> {
  if (!workspaceId || !className) return [];
  const columns = activeOnly(await fetchColumns(workspaceId, className));
  // Tanpa orderBy, Firestore mengembalikan dokumen urut ID acak — kolom
  // nilai jadi berpindah-pindah posisi dan "perkembangan nilai" di grafik
  // siswa tidak berarti apa-apa. Diurutkan sesuai waktu kolom dibuat, yang
  // mendekati urutan asesmen sepanjang semester.
  return columns.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

// createdAt bisa berupa Timestamp Firestore, atau null sesaat setelah
// ditulis (serverTimestamp belum terisi saat masih di cache lokal).
function toMillis(createdAt: unknown): number {
  if (!createdAt || typeof createdAt !== 'object') return 0;
  const t = createdAt as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return 0;
}

export async function createColumn(data: Record<string, unknown>) {
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

export async function createDefaultColumns(workspaceId: string, className: string): Promise<Doc<GradeColumnData>[]> {
  if (!workspaceId || !className) return [];
  const created: Doc<GradeColumnData>[] = [];
  for (const col of DEFAULT_GRADE_COLUMNS) {
    const result = await createColumn({ workspaceId, className, title: col.title, type: col.type });
    created.push({ id: result.id, workspaceId, className, title: col.title, type: col.type });
  }
  return created;
}
