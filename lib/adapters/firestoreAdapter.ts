import * as supabase from './supabaseAdapter';
import * as firebaseLegacy from './firestoreLegacyAdapter';

/**
 * Stable contract exposed to repositories.
 *
 * The adapter facade previously re-exported functions directly from a
 * conditional union (`firebaseLegacy | supabase`). TypeScript then inferred
 * union function signatures, which caused tuple filters such as
 * `['workspaceId', '==', workspaceId]` to lose their contextual tuple type
 * during production builds. Keep the backend switch internal and expose one
 * explicit repository-facing contract instead.
 */
export type QueryFilter = [field: string, operator: string, value: unknown];
export type BatchOperation =
  | { type: 'set'; collectionName: string; id: string; data: Record<string, any> }
  | { type: 'delete'; collectionName: string; id: string };

type BackendAdapter = {
  serverTimestamp: () => unknown;
  getDocuments: (collectionName: string, filters?: QueryFilter[]) => Promise<any[]>;
  getDocument: (collectionName: string, id: string) => Promise<any | null>;
  countDocuments: (collectionName: string, filters?: QueryFilter[]) => Promise<number>;
  addDocument: (collectionName: string, data: Record<string, any>) => Promise<any>;
  setDocument: (collectionName: string, id: string, data: Record<string, any>) => Promise<any>;
  updateDocument: (collectionName: string, id: string, data: Record<string, any>) => Promise<any>;
  deleteDocument: (collectionName: string, id: string) => Promise<boolean>;
  generateId: (collectionName: string) => string;
  batchWrite: (operations: BatchOperation[]) => Promise<boolean>;
};

const USE_FIREBASE_EMULATOR = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';

// Both implementations conform to the same public contract. The selected
// backend never leaks its module-level union type into repository callers.
const backend: BackendAdapter = USE_FIREBASE_EMULATOR
  ? firebaseLegacy
  : supabase;

export const serverTimestamp = () => backend.serverTimestamp();

export function getDocuments(
  collectionName: string,
  filters: QueryFilter[] = [],
) {
  return backend.getDocuments(collectionName, filters);
}

export function getDocument(collectionName: string, id: string) {
  return backend.getDocument(collectionName, id);
}

export function countDocuments(
  collectionName: string,
  filters: QueryFilter[] = [],
) {
  return backend.countDocuments(collectionName, filters);
}

export function addDocument(collectionName: string, data: Record<string, any>) {
  return backend.addDocument(collectionName, data);
}

export function setDocument(
  collectionName: string,
  id: string,
  data: Record<string, any>,
) {
  return backend.setDocument(collectionName, id, data);
}

export function updateDocument(
  collectionName: string,
  id: string,
  data: Record<string, any>,
) {
  return backend.updateDocument(collectionName, id, data);
}

export function deleteDocument(collectionName: string, id: string) {
  return backend.deleteDocument(collectionName, id);
}

export function generateId(collectionName: string) {
  return backend.generateId(collectionName);
}

export function batchWrite(operations: BatchOperation[]) {
  return backend.batchWrite(operations);
}
