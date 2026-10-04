import * as supabase from './supabaseAdapter';
import * as firebaseLegacy from './firestoreLegacyAdapter';

const USE_FIREBASE_EMULATOR = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
const backend = USE_FIREBASE_EMULATOR ? firebaseLegacy : supabase;

export const serverTimestamp = backend.serverTimestamp;
export const getDocuments = backend.getDocuments;
export const getDocument = backend.getDocument;
export const countDocuments = backend.countDocuments;
export const addDocument = backend.addDocument;
export const setDocument = backend.setDocument;
export const updateDocument = backend.updateDocument;
export const deleteDocument = backend.deleteDocument;
export const generateId = backend.generateId;
export const batchWrite = backend.batchWrite;
export type BatchOperation = supabase.BatchOperation;
