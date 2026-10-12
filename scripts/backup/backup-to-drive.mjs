#!/usr/bin/env node
// Backup Firestore → berkas terenkripsi → Google Drive pribadi (scope drive.file). Lihat docs/BACKUP-DRIVE.md.
//   Env: FIREBASE_SERVICE_ACCOUNT (JSON; tidak perlu bila memakai emulator), BACKUP_ENCRYPTION_KEY,
//        DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET, DRIVE_REFRESH_TOKEN, [DRIVE_FOLDER_NAME], [BACKUP_MAX_DOCS]
//   Opsi: --out <berkas>  tulis lokal saja (tanpa Drive; untuk verifikasi)   --project <id>
import { appendFileSync, writeFileSync } from 'node:fs';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { exportFirestore, openBackup, parseBackup, sealBackup } from './firestoreBackup.mjs';
import { backupFilename, driveClient, getAccessToken, selectForDeletion } from './driveClient.mjs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error(`GAGAL: ${m}`); process.exit(1); };

const key = process.env.BACKUP_ENCRYPTION_KEY;
if (!key) fail('BACKUP_ENCRYPTION_KEY belum diisi.');
const out = opt('--out');
const need = ['DRIVE_CLIENT_ID', 'DRIVE_CLIENT_SECRET', 'DRIVE_REFRESH_TOKEN'].filter((k) => !process.env[k]);
if (!out && need.length) fail(`Secret Drive belum lengkap: ${need.join(', ')} (atau pakai --out untuk berkas lokal).`);

let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try { credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)); } catch { fail('FIREBASE_SERVICE_ACCOUNT bukan JSON service account yang valid.'); }
} else if (!process.env.FIRESTORE_EMULATOR_HOST) credential = applicationDefault();
const projectId = opt('--project') || process.env.FIREBASE_PROJECT_ID;
if (!projectId) fail('Project ID tidak diketahui (--project atau FIREBASE_PROJECT_ID).');
const app = initializeApp({ projectId, ...(credential ? { credential } : {}) });
const db = getFirestore(app);

const now = new Date();
let exported;
try {
  exported = await exportFirestore(db, { projectId, maxDocs: Number(process.env.BACKUP_MAX_DOCS) || 20000, recursive: process.env.BACKUP_RECURSIVE === 'yes' });
} catch (e) { fail(`export Firestore: ${e instanceof Error ? e.message : 'error'}`); }
const sealed = sealBackup(exported.ndjson, key);
// Pastikan berkas yang akan diarsipkan benar-benar bisa dibuka & konsisten SEBELUM diunggah.
const check = parseBackup(openBackup(sealed, key));
if (check.manifest.totalDocs !== exported.manifest.totalDocs) fail('Verifikasi lokal backup gagal.');

const m = exported.manifest;
// Backup kosong yang tampak sukses adalah kegagalan paling berbahaya (mis. salah proyek/izin). Tolak kecuali disengaja.
if (m.totalDocs === 0 && process.env.BACKUP_ALLOW_EMPTY !== 'yes') fail('Backup berisi 0 dokumen — ditolak (salah project/izin baca?). Set BACKUP_ALLOW_EMPTY=yes bila database memang kosong.');
const summary = `Backup ${backupFilename(now)}: ${m.totalDocs} dokumen, ${Object.keys(m.collections).length} koleksi, konsisten=${m.consistent}, ${sealed.length} byte (terenkripsi)`;
if (!m.consistent) console.warn('PERINGATAN: backup tidak memakai satu readTime (bukan snapshot konsisten lintas koleksi).');

if (out) { writeFileSync(out, sealed); console.log(`${summary} → ${out}`); process.exit(0); }

// Hanya untuk tes lokal: server Drive palsu, diizinkan HANYA bila Firestore Emulator aktif (env itu tidak ada di GitHub Actions/produksi).
const fake = process.env.FIRESTORE_EMULATOR_HOST ? process.env.DRIVE_FAKE_BASE : undefined;
const net = fake ? { endpoints: { token: `${fake}/token`, api: `${fake}/drive`, upload: `${fake}/upload` } } : {};
const token = await getAccessToken({ clientId: process.env.DRIVE_CLIENT_ID, clientSecret: process.env.DRIVE_CLIENT_SECRET, refreshToken: process.env.DRIVE_REFRESH_TOKEN }, net).catch((e) => fail(e.message));
const drive = driveClient(token, net);
const folderId = await drive.ensureFolder(process.env.DRIVE_FOLDER_NAME || 'TeacherWorkspace-Backups');
const up = await drive.uploadVerified(folderId, backupFilename(now), sealed);
const old = selectForDeletion(await drive.listBackups(folderId));
for (const f of old) await drive.remove(f.id);
const line = `${summary} → Drive (MD5 terverifikasi), retensi menghapus ${old.length} berkas lama`;
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Backup Firestore → Drive\n${line}\n\nKoleksi: ${JSON.stringify(m.collections)}\n`);
void up;
