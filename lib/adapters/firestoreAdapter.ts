import { auth, db } from '@/src/config/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  getCountFromServer,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  documentId,
  writeBatch,
  serverTimestamp,
  QueryConstraint,
} from 'firebase/firestore';

// Re-export sentinel value (bukan operasi Firestore) supaya repository yang
// perlu menandai createdAt/updatedAt sendiri (mis. workspaceRepository) tidak
// perlu import 'firebase/firestore' langsung untuk itu.
export { serverTimestamp };

function buildQuery(collectionName: string, filters: [string, any, any][]) {
  const constraints: QueryConstraint[] = filters.map(([field, op, value]) => where(field, op, value));
  return constraints.length > 0
    ? query(collection(db, collectionName), ...constraints)
    : collection(db, collectionName);
}

// Dokumen Firestore + id. Pemanggil boleh menyebut bentuk datanya (lib/types/models.ts);
// tanpa itu bentuknya longgar (Record<string, any>) seperti sebelumnya.
export type DocData = Record<string, any>;
export type Doc<T extends object = DocData> = T & { id: string };
export type Filter = [string, any, any];

export async function getDocuments<T extends object = DocData>(collectionName: string, filters: Filter[] = []): Promise<Doc<T>[]> {
  const snapshot = await getDocs(buildQuery(collectionName, filters));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as Doc<T>);
}

export type DocumentsPage<T extends object = DocData> = { docs: Doc<T>[]; nextCursor: string | null };

/**
 * Satu halaman dokumen (limit + startAfter), urut id dokumen. `cursor` = nextCursor halaman
 * sebelumnya (null/undefined = halaman pertama). nextCursor null = tidak ada halaman berikutnya.
 * Hanya filter kesetaraan ('==') — urutan id tidak butuh indeks komposit. Untuk daftar yang
 * bisa tumbuh besar (UI "muat lebih banyak"), bukan untuk rentang tanggal.
 */
export async function getDocumentsPage<T extends object = DocData>(
  collectionName: string,
  filters: Filter[] = [],
  options: { pageSize?: number; cursor?: string | null } = {}
): Promise<DocumentsPage<T>> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 200, 1), 1000);
  const constraints: QueryConstraint[] = [
    ...filters.map(([field, op, value]) => where(field, op, value)),
    orderBy(documentId()),
    ...(options.cursor ? [startAfter(options.cursor)] : []),
    limit(pageSize),
  ];
  const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
  const docs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as Doc<T>);
  return { docs, nextCursor: docs.length === pageSize ? docs[docs.length - 1].id : null };
}

/**
 * Semua dokumen yang cocok, DIAMBIL BERTAHAP (halaman 500) — bukan satu respons raksasa.
 * Total bacaan tetap sebanyak dokumennya; keuntungannya memori/latensi per permintaan
 * terbatas dan tidak ada satu panggilan yang bisa menggantung pada koleksi besar.
 * Hanya untuk agregat yang memang butuh seluruh set (mis. hitung siswa per kelas).
 */
export async function getAllDocumentsPaged<T extends object = DocData>(
  collectionName: string,
  filters: Filter[] = [],
  options: { pageSize?: number } = {}
): Promise<Doc<T>[]> {
  const all: Doc<T>[] = [];
  let cursor: string | null = null;
  do {
    const page: DocumentsPage<T> = await getDocumentsPage<T>(collectionName, filters, { pageSize: options.pageSize ?? 500, cursor });
    all.push(...page.docs);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

// Firestore membatasi operator `in` (30 nilai per query). Memecah nilai ke beberapa query
// dan menggabungkan hasilnya — dipakai untuk "submission milik tugas-tugas ini" tanpa
// mengunduh seluruh riwayat.
export const FIRESTORE_IN_LIMIT = 30;

export async function getDocumentsWhereIn<T extends object = DocData>(
  collectionName: string,
  baseFilters: Filter[],
  field: string,
  values: string[]
): Promise<Doc<T>[]> {
  const unique = [...new Set(values)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += FIRESTORE_IN_LIMIT) chunks.push(unique.slice(i, i + FIRESTORE_IN_LIMIT));
  const results = await Promise.all(chunks.map((chunk) => getDocuments<T>(collectionName, [...baseFilters, [field, 'in', chunk]])));
  return results.flat();
}

export async function getDocument<T extends object = DocData>(collectionName: string, id: string): Promise<Doc<T> | null> {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Doc<T>) : null;
}

// Baca dari cache lokal Firestore saja (tanpa menunggu jaringan). null kalau
// belum ada di cache — dipakai untuk menampilkan data yang sudah pernah
// dimuat secepatnya sebelum versi server tiba.
export async function getDocumentFromCache(collectionName: string, id: string) {
  try {
    const snap = await getDocFromCache(doc(db, collectionName, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
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
  // createdBy = uid pembuat (dari sesi, bukan dari pemanggil): dasar aturan
  // "hanya pembuat atau OWNER/ADMIN yang boleh menghapus" di firestore.rules.
  // Immutable setelah dibuat.
  const createdBy = auth.currentUser?.uid;
  // Tanpa sesi login createdBy tak bisa dicap dan aturan server pasti menolak — gagal lebih awal dengan sebab yang jelas.
  if (!createdBy) throw Object.assign(new Error('Sesi login belum siap.'), { code: 'unauthenticated' });
  const docRef = await addDoc(collection(db, collectionName), {
    ...data,
    createdBy,
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id, ...data };
}

// Soft delete: dokumen TIDAK dihapus, hanya ditandai (deletedAt/deletedBy) dan
// disaring dari semua query repository (lib/utils/softDelete.ts). Pemulihan
// mengosongkan tanda itu. Siapa yang boleh menandai/memulihkan dijaga
// firestore.rules (pembuat dokumen atau OWNER/ADMIN).
export async function softDeleteDocument(collectionName: string, id: string) {
  await updateDoc(doc(db, collectionName, id), {
    deletedAt: serverTimestamp(),
    deletedBy: auth.currentUser?.uid ?? null,
  });
  return true;
}

export async function restoreDocument(collectionName: string, id: string) {
  await updateDoc(doc(db, collectionName, id), { deletedAt: null, deletedBy: null, deletedBatchId: null });
  return true;
}

// Beda dari updateDocument: berhasil walau dokumennya belum ada sama
// sekali (updateDoc menolak kalau dokumen belum ada — masalah untuk tulisan
// pertama ke dokumen ber-ID tetap seperti profil pengguna, bukan ID
// auto-generate seperti addDocument). merge:true supaya field yang tidak
// disebut tidak ikut terhapus.
export async function setDocument(collectionName: string, id: string, data: Record<string, any>) {
  await setDoc(doc(db, collectionName, id), data, { merge: true });
  return { id, ...data };
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

// Firestore menolak commit dengan lebih dari 500 operasi dalam satu batch.
// Impor massal siswa (2 operasi/siswa: dokumen siswa + kode akses) dan hapus
// seluruh kelas bisa saja melebihi itu untuk kelas besar, jadi dipecah jadi
// beberapa batch berurutan alih-alih satu batch yang bisa gagal total.
const MAX_BATCH_OPERATIONS = 500;

/**
 * Banyak perubahan sekaligus, dipecah otomatis jika melebihi batas 500
 * operasi per batch Firestore. Dipakai gradeRepository (simpan nilai) dan
 * studentRepository (impor massal siswa, hapus seluruh kelas).
 */
export async function batchWrite(operations: BatchOperation[]) {
  for (let i = 0; i < operations.length; i += MAX_BATCH_OPERATIONS) {
    const chunk = operations.slice(i, i + MAX_BATCH_OPERATIONS);
    const batch = writeBatch(db);

    chunk.forEach((op) => {
      const ref = doc(db, op.collectionName, op.id);
      if (op.type === 'set') {
        batch.set(ref, op.data, { merge: true });
      } else {
        batch.delete(ref);
      }
    });

    await batch.commit();
  }
  return true;
}
