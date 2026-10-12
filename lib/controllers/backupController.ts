import * as service from '../services/backupService';
import { BackupApiError } from '../repositories/backupRepository';

export type { BackupResult, BackupSummary, AttachmentProgress } from '../services/backupService';
export const MIN_PASSPHRASE = service.MIN_PASSPHRASE;
export const validatePassphrase = service.validatePassphrase;
export const createBackup = (passphrase: string) => service.createBackup(passphrase);
export const downloadAttachments = service.downloadAllAttachments;
export const decryptBackupFile = service.decryptBackupFile;

export function describeBackupError(e: unknown): string {
  if (e instanceof BackupApiError) return e.message;
  if (e instanceof Error && /kata sandi|Kata sandi|arsip terenkripsi/.test(e.message)) return e.message;
  return 'Backup gagal. Coba lagi beberapa saat lagi.';
}
