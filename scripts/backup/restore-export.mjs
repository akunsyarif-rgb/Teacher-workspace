#!/usr/bin/env node
// Verifikasi dan pulihkan arsip dari menu "Backup & Ekspor Data". Default: HANYA verifikasi (tidak menulis apa pun).
//   node scripts/backup/restore-export.mjs <arsip.zip|arsip.zip.enc> --project <id-tujuan> [--apply]
// Berkas terenkripsi: set BACKUP_PASSPHRASE (kata sandi yang Anda pilih saat mengunduh).
// Menulis ke emulator (FIRESTORE_EMULATOR_HOST) cukup --apply. Ke Firestore NYATA wajib:
//   --apply --confirm-project <id-tujuan> --i-know-this-writes-real-data   (+ FIREBASE_SERVICE_ACCOUNT milik project tujuan)
// Hanya data Firestore yang dipulihkan. Ulangan Harian (JSON) dan isi lampiran tidak dipulihkan otomatis.
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { decryptArchive, isEncryptedArchive } from '../../lib/backup/archiveCrypto.mjs';
import { restoreDocs, verifyExportZip } from '../../lib/backup/archive.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error(`GAGAL: ${m}`); process.exit(1); };

const project = opt('--project');
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project' && argv[i - 1] !== '--confirm-project');
if (!file || !project) fail('Pemakaian: restore-export.mjs <arsip> --project <id-tujuan> [--apply]');

let bytes = new Uint8Array(readFileSync(file));
if (isEncryptedArchive(bytes)) {
  if (!process.env.BACKUP_PASSPHRASE) fail('Arsip terenkripsi: set BACKUP_PASSPHRASE.');
  try { bytes = await decryptArchive(process.env.BACKUP_PASSPHRASE, bytes); } catch (e) { fail(e.message); }
}
let verified;
try { verified = verifyExportZip(Buffer.from(bytes)); } catch (e) { fail(`Arsip TIDAK valid: ${e.message}`); }
const { manifest, docs } = verified;
console.log(`Arsip VALID. Diekspor ${manifest.exportedAt}, workspace ${manifest.workspace?.id}, ${manifest.firestore.totalDocs} dokumen, peran ${manifest.exportedBy?.role}.`);
console.log(`Cakupan: Firestore=${manifest.coverage.firestore}, Ulangan=${manifest.coverage.ulangan}, keseluruhan=${manifest.coverage.overall}.`);
for (const g of manifest.gaps) console.log(`  - belum tercakup (${g.source}): ${g.detail}`);

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const apply = flag('--apply');
if (apply && !emulator) {
  if (opt('--confirm-project') !== project || !flag('--i-know-this-writes-real-data')) fail('Menulis ke Firestore NYATA butuh --confirm-project <id-tujuan> dan --i-know-this-writes-real-data.');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) fail('FIREBASE_SERVICE_ACCOUNT belum diisi untuk Firestore nyata.');
}
let credential;
if (!emulator && process.env.FIREBASE_SERVICE_ACCOUNT) { try { credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)); } catch { fail('FIREBASE_SERVICE_ACCOUNT tidak valid.'); } }
if (!apply) { console.log('VERIFIKASI SAJA: tidak ada yang ditulis. Tambahkan --apply untuk memulihkan.'); process.exit(0); }
const db = getFirestore(initializeApp({ projectId: project, ...(credential ? { credential } : {}) }));
const s = await restoreDocs(db, docs, { apply: true });
console.log(`Dipulihkan ke ${emulator ? 'EMULATOR' : 'Firestore nyata'} (${project}): ${s.written}/${s.totalDocs} dokumen.`);
