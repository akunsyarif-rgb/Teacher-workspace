import { db } from '@/src/config/firebase';
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
  QueryConstraint,
} from 'firebase/firestore';

export async function getDocuments(collectionName: string, filters: [string, any, any][] = []) {
  const constraints: QueryConstraint[] = filters.map(([field, op, value]) => where(field, op, value));
  const q =
    constraints.length > 0
      ? query(collection(db, collectionName), ...constraints)
      : collection(db, collectionName);

  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function addDocument(collectionName: string, data: Record<string, any>) {
  const docRef = await addDoc(collection(db, collectionName), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id, ...data };
}

export async function updateDocument(collectionName: string, id: string, data: Record<string, any>) {
  await updateDoc(doc(db, collectionName, id), data);
  return { id, ...data };
}

export async function deleteDocument(collectionName: string, id: string) {
  await deleteDoc(doc(db, collectionName, id));
  return true;
}

/**
 * Menghasilkan id dokumen baru tanpa menulis apa pun — dipakai saat kita
 * perlu tahu id sebelum commit (mis. untuk batch import banyak siswa).
 */
export function generateId(collectionName: string) {
  return doc(collection(db, collectionName)).id;
}

export type BatchOperation =
  | { type: 'set'; collectionName: string; id: string; data: Record<string, any> }
  | { type: 'delete'; collectionName: string; id: string };

/**
 * Satu commit untuk banyak perubahan sekaligus. Dipakai gradeRepository
 * (simpan nilai) dan sekarang studentRepository (impor massal siswa).
 */
export async function batchWrite(operations: BatchOperation[]) {
  const batch = writeBatch(db);

  operations.forEach((op) => {
    const ref = doc(db, op.collectionName, op.id);
    if (op.type === 'set') {
      batch.set(ref, op.data, { merge: true });
    } else {
      batch.delete(ref);
    }
  });

  await batch.commit();
  return true;
}
