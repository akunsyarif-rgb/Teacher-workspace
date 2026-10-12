export type Endpoints = { token: string; api: string; upload: string };
export const DEFAULT_ENDPOINTS: Endpoints;
export const BACKUP_PREFIX: string;
export function getAccessToken(c: { clientId: string; clientSecret: string; refreshToken: string }, d?: { fetchImpl?: typeof fetch; endpoints?: Endpoints }): Promise<string>;
export function driveClient(token: string, d?: { fetchImpl?: typeof fetch; endpoints?: Endpoints }): {
  ensureFolder(name: string): Promise<string>;
  uploadVerified(folderId: string, filename: string, buf: Buffer): Promise<{ id: string; size: number; md5: string }>;
  listBackups(folderId: string): Promise<{ id: string; name: string; size?: string }[]>;
  remove(id: string): Promise<void>;
};
export function backupFilename(d: Date): string;
export function selectForDeletion<T extends { id: string; name: string }>(files: T[], p?: { daily?: number; weekly?: number; monthly?: number }): T[];
