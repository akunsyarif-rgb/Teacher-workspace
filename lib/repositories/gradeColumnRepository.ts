import { getDocuments, addDocument, deleteDocument } from '../adapters/firestoreAdapter';
import { COLLECTIONS, DEFAULT_GRADE_COLUMNS } from '../config/constants';

export async function getColumnsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  const columns = await getDocuments(COLLECTIONS.GRADE_COLUMNS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
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

export async function deleteColumn(id: string) {
  return deleteDocument(COLLECTIONS.GRADE_COLUMNS, id);
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
