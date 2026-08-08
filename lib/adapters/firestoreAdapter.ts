import { db } from '@/src/config/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
  serverTimestamp,
  QueryConstraint,
} from 'firebase/firestore';

function buildQuery(collectionName: string, filters: [string, any, any][]) {
  const constraints: QueryConstraint[] = filters.map(([field, op, value]) => where(field, op, value));
  return constraints.length > 0
    ? query(collection(db, collectionName), ...constraints)
    : collection(db, collectionName);
}

export async function getDocuments(collectionName: string, filters: [string, any, any][] = []) {
  const snapshot = await getDocs(buildQuery(collectionName, filters));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function getDocument(collectionName: string, id: string) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Hitung jumlah dokumen lewat aggregation query Firestore (getCountFromServer)
// — tidak mengunduh isi dokumennya sama sekali, jadi tetap murah dan cepat
// berapa pun banyaknya dokumen di koleksi itu. Dipakai untuk statistik
// "total" yang cuma butuh angkanya, bukan datanya.
export async function countDocuments(collectionName: string, filters: [string, any, any][] = []) {
  const snapshot = await getCountFromServer(buildQuery(collectionName, filters));
  return snapshot.data().count;
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
