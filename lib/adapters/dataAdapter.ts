import * as firestore from './firestoreAdapter';
import { isSupabaseCollection } from '../config/dataBackend';
import { getSupabaseAdapter } from './supabaseClient';

// Satu-satunya tempat yang memilih backend data per koleksi. Repository memanggil adapterFor(koleksi)
// dan tidak tahu backend mana yang dipakai. Default (tanpa flag) = Firestore. Tidak ada dual-write dan
// tidak ada fallback: kegagalan Supabase merambat ke pemanggil.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DataAdapter {
  getDocuments(c: string, filters?: [string, any, any][]): Promise<any[]>;
  getDocument(c: string, id: string): Promise<any | null>;
  addDocument(c: string, data: Record<string, any>): Promise<any>;
  setDocument(c: string, id: string, data: Record<string, any>): Promise<any>;
  updateDocument(c: string, id: string, data: Record<string, any>): Promise<any>;
  deleteDocument(c: string, id: string): Promise<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function adapterFor(collectionName: string): DataAdapter {
  return isSupabaseCollection(collectionName) ? (getSupabaseAdapter() as unknown as DataAdapter) : (firestore as unknown as DataAdapter);
}
