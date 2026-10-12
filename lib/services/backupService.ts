import * as repo from '../repositories/backupRepository';
import { decryptArchive, encryptArchive, isEncryptedArchive } from '../backup/archiveCrypto.mjs';
import { readZipEntry } from '../backup/zipEntry.mjs';

export const MIN_PASSPHRASE = 8;
export type BackupSummary = {
  exportedAt: string; totalDocs: number; collections: { name: string; status: string; count: number }[];
  ulangan: { status: string; reason?: string; exams?: number }; attachments: { count: number; bySource: Record<string, number> };
  gaps: { source: string; detail: string }[]; excluded: { name: string; reason: string }[]; unrecognized: string[]; coverage: { firestore: string; overall: string };
};
export type BackupResult = { bytes: Uint8Array; filename: string; encrypted: boolean; summary: BackupSummary | null };

export function validatePassphrase(pass: string, confirm: string): string | null {
  if (pass.length < MIN_PASSPHRASE) return `Kata sandi minimal ${MIN_PASSPHRASE} karakter.`;
  if (pass !== confirm) return 'Konfirmasi kata sandi tidak sama.';
  return null;
}

/** Ringkasan cakupan dibaca dari manifest.json di dalam arsip; null bila browser tidak mendukung (arsip tetap sah). */
async function summaryOf(zip: Uint8Array): Promise<BackupSummary | null> {
  try {
    const raw = await readZipEntry(zip, 'manifest.json');
    if (!raw) return null;
    const m = JSON.parse(new TextDecoder().decode(raw));
    return {
      exportedAt: m.exportedAt, totalDocs: m.firestore.totalDocs,
      collections: Object.entries<{ status: string; count: number }>(m.firestore.collections).map(([name, c]) => ({ name, status: c.status, count: c.count })),
      ulangan: m.ulangan, attachments: { count: m.attachments.index.count, bySource: m.attachments.index.bySource },
      gaps: m.gaps, excluded: m.excluded, unrecognized: m.firestore.unrecognizedCollections, coverage: m.coverage,
    };
  } catch { return null; }
}

/** passphrase kosong = tidak dienkripsi. Kata sandi dipakai hanya di perangkat ini (WebCrypto), tidak dikirim ke server. */
export async function createBackup(passphrase: string): Promise<BackupResult> {
  const { bytes, filename } = await repo.downloadExport();
  const summary = await summaryOf(bytes);
  if (!passphrase) return { bytes, filename, encrypted: false, summary };
  return { bytes: await encryptArchive(passphrase, bytes), filename: `${filename}.enc`, encrypted: true, summary };
}

export type AttachmentProgress = { part: number; files: number; total: number };
/** Mengunduh lampiran bagian demi bagian; `save` dipanggil per bagian (perangkat menyimpan tiap bagian sebagai berkas terpisah). */
export async function downloadAllAttachments(passphrase: string, save: (name: string, bytes: Uint8Array) => void, onProgress: (p: AttachmentProgress) => void): Promise<{ files: number; parts: number }> {
  const plan = await repo.fetchAttachmentPlan();
  let i = 0; let part = 0;
  onProgress({ part: 0, files: 0, total: plan.length });
  while (i < plan.length) {
    const { bytes, included } = await repo.downloadAttachmentPart(plan.slice(i, i + 30).map((f) => f.path));
    part++; i += included;
    const out = passphrase ? await encryptArchive(passphrase, bytes) : bytes;
    save(`teacher-workspace-lampiran-bagian-${String(part).padStart(2, '0')}.zip${passphrase ? '.enc' : ''}`, out);
    onProgress({ part, files: i, total: plan.length });
  }
  return { files: plan.length, parts: part };
}

/** Membuka berkas .enc di perangkat ini (tanpa server). Hasilnya ZIP biasa yang bisa dibuka aplikasi arsip apa pun. */
export async function decryptBackupFile(bytes: Uint8Array, passphrase: string, name: string): Promise<{ bytes: Uint8Array; filename: string }> {
  if (!isEncryptedArchive(bytes)) throw new Error('Berkas ini bukan arsip terenkripsi Teacher Workspace (.zip.enc).');
  return { bytes: await decryptArchive(passphrase, bytes), filename: name.replace(/\.enc$/i, '') || 'teacher-workspace-backup.zip' };
}
