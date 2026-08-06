import { getDocuments, addDocument, deleteDocument, batchWrite, BatchOperation } from '../adapters/firestoreAdapter';
import { COLLECTIONS } from '../config/constants';

// Dipakai guru (wali kelas) untuk mengelola prestasi satu kelas.
export async function getAchievementsByClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return getDocuments(COLLECTIONS.STUDENT_ACHIEVEMENTS, [
    ['workspaceId', '==', workspaceId],
    ['className', '==', className],
  ]);
}

// Dipakai Student Companion. Filter studentId wajib: rules siswa hanya
// mengizinkan baca prestasi miliknya sendiri, dan query list baru lolos
// kalau filternya menjamin hal itu.
export async function getAchievementsByStudent(workspaceId: string, studentId: string) {
  if (!workspaceId || !studentId) return [];
  return getDocuments(COLLECTIONS.STUDENT_ACHIEVEMENTS, [
    ['workspaceId', '==', workspaceId],
    ['studentId', '==', studentId],
  ]);
}

export async function createAchievement(data: Record<string, any>) {
  return addDocument(COLLECTIONS.STUDENT_ACHIEVEMENTS, data);
}

export async function deleteAchievement(id: string) {
  return deleteDocument(COLLECTIONS.STUDENT_ACHIEVEMENTS, id);
}

/**
 * Menyalin prestasi lama dari student_notes. Id dokumen sengaja memakai id
 * catatan asalnya, sehingga menjalankan ulang migrasi hanya menimpa
 * dokumen yang sama — tidak pernah menghasilkan duplikat. Catatan aslinya
 * di student_notes tidak disentuh sama sekali (tidak dihapus), supaya
 * migrasi yang keliru tidak pernah berarti kehilangan data.
 */
export async function copyFromNotes(notes: { id: string; [key: string]: any }[]) {
  if (notes.length === 0) return 0;
  const operations: BatchOperation[] = notes.map((note) => ({
    type: 'set',
    collectionName: COLLECTIONS.STUDENT_ACHIEVEMENTS,
    id: note.id,
    data: {
      workspaceId: note.workspaceId,
      className: note.className,
      studentId: note.studentId,
      studentName: note.studentName,
      title: note.title,
      notes: note.notes || '',
      date: note.date,
      migratedFromNoteId: note.id,
    },
  }));
  await batchWrite(operations);
  return operations.length;
}
