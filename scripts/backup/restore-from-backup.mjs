#!/usr/bin/env node
// Restore backup terenkripsi ke Firestore TUJUAN. Default DRY-RUN (hanya membuka + memverifikasi berkas).
//   node scripts/backup/restore-from-backup.mjs <berkas.twb> --project <id-tujuan> [--apply]
// Aman: ke emulator (FIRESTORE_EMULATOR_HOST) cukup --apply. Ke Firestore nyata WAJIB:
//   --apply --confirm-project <id-tujuan> [--allow-overwrite-source-project bila id-tujuan = proyek asal backup]
// Env: BACKUP_ENCRYPTION_KEY; FIREBASE_SERVICE_ACCOUNT (hanya untuk Firestore nyata).
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { openBackup, parseBackup, restoreInto } from './firestoreBackup.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error(`GAGAL: ${m}`); process.exit(1); };

const file = argv.find((a) => !a.startsWith('--') && a !== opt('--project') && a !== opt('--confirm-project'));
const project = opt('--project');
if (!file || !project) fail('Pemakaian: restore-from-backup.mjs <berkas.twb> --project <id-tujuan> [--apply]');
if (!process.env.BACKUP_ENCRYPTION_KEY) fail('BACKUP_ENCRYPTION_KEY belum diisi.');

let parsed;
try { parsed = parseBackup(openBackup(readFileSync(file), process.env.BACKUP_ENCRYPTION_KEY)); } catch (e) { fail(e.message); }
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
console.log(`Backup: proyek asal ${parsed.manifest.projectId}, ${parsed.manifest.createdAt}, ${parsed.manifest.totalDocs} dokumen, koleksi ${JSON.stringify(parsed.manifest.collections)}`);

const apply = flag('--apply');
if (apply && !emulator) {
  if (opt('--confirm-project') !== project) fail('Restore ke Firestore NYATA butuh --confirm-project <id-tujuan> yang sama dengan --project.');
  if (project === parsed.manifest.projectId && !flag('--allow-overwrite-source-project')) fail('Tujuan = proyek asal backup: menimpa data hidup. Tambahkan --allow-overwrite-source-project bila memang disengaja.');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) fail('FIREBASE_SERVICE_ACCOUNT belum diisi untuk Firestore nyata.');
}
let credential;
if (!emulator && process.env.FIREBASE_SERVICE_ACCOUNT) { try { credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)); } catch { fail('FIREBASE_SERVICE_ACCOUNT tidak valid.'); } }
const db = getFirestore(initializeApp({ projectId: project, ...(credential ? { credential } : {}) }));
const s = await restoreInto(db, parsed, { apply });
console.log(apply ? `Restore selesai ke ${emulator ? 'EMULATOR' : 'Firestore nyata'} (${project}): ${s.written}/${s.totalDocs} dokumen ditulis.` : 'DRY-RUN: berkas valid & terbuka; tidak ada yang ditulis. Tambahkan --apply untuk menulis.');
