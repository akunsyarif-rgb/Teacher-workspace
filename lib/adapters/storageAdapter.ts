import * as supabaseStorage from './storageSupabaseAdapter';
import * as firebaseStorage from './storageLegacyAdapter';

const USE_FIREBASE_EMULATOR = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
const backend = USE_FIREBASE_EMULATOR ? firebaseStorage : supabaseStorage;

export const MAX_SUBMISSION_FILES = backend.MAX_SUBMISSION_FILES;
export const MAX_UPLOAD_BYTES = backend.MAX_UPLOAD_BYTES;
export const resolveUploadContentType = backend.resolveUploadContentType;
export const validateUploadFile = backend.validateUploadFile;
export const uploadSubmissionFile = backend.uploadSubmissionFile;
export const uploadSubmissionFiles = backend.uploadSubmissionFiles;
export const uploadAssignmentFile = backend.uploadAssignmentFile;
export const createAttachmentSignedUrl = USE_FIREBASE_EMULATOR
  ? async (_path: string) => { throw new Error('Signed URL Supabase tidak tersedia dalam mode Firebase emulator.'); }
  : supabaseStorage.createAttachmentSignedUrl;
export const SUPABASE_SUBMISSION_BUCKET = 'submission-attachments';
