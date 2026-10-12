import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { GeoPoint, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { exportFirestore, fingerprint, openBackup, parseBackup, restoreInto, sealBackup } from '../scripts/backup/firestoreBackup.mjs';
import { backupFilename, driveClient, getAccessToken, selectForDeletion } from '../scripts/backup/driveClient.mjs';

// Backup → enkripsi → (Drive palsu) → buka → restore ke proyek TERPISAH di emulator → sidik jari isi harus identik.
// Berjalan di `npm run test:rules` (emulator Firestore); tidak menyentuh Firestore/Drive nyata.
const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const KEY = 'kunci-uji-backup-minimal-16-karakter';
const SRC = 'demo-backup-src';
const DST = 'demo-backup-dst';
const ROOT = path.resolve(__dirname, '..');
const dbOf = (id: string): Firestore => getFirestore(getApps().find((a) => a.name === id) ?? initializeApp({ projectId: id }, id));
const wipe = (id: string) => fetch(`http://${EMU}/emulator/v1/projects/${id}/databases/(default)/documents`, { method: 'DELETE' });
const cliEnv = (extra: Record<string, string> = {}) => ({ PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', BACKUP_ENCRYPTION_KEY: KEY, FIRESTORE_EMULATOR_HOST: EMU ?? '', ...extra });
const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync('node', [path.join(ROOT, 'scripts/backup', script), ...args], { env: env as NodeJS.ProcessEnv, encoding: 'utf8', cwd: ROOT });

// Asinkron: server Drive palsu hidup di proses tes ini, jadi spawnSync (yang memblokir event loop) akan deadlock.
const runAsync = (script: string, args: string[], env: Record<string, string>) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = spawn('node', [path.join(ROOT, 'scripts/backup', script), ...args], { env: env as NodeJS.ProcessEnv, cwd: ROOT });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; }); p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });

async function seed(db: Firestore) {
  const ref = db.collection('students').doc('s1');
  await ref.set({ name: 'Budi Santoso', nilai: 87.5, aktif: true, kosong: null, tags: ['a', 1, { x: [true] }], created: Timestamp.fromMillis(1_700_000_123_456), lokasi: new GeoPoint(-3.8, 122.5), foto: Buffer.from([0, 1, 2, 255]), unik: 'Ünïcödé 🎓', __t: 'bukan-tipe', nested: { dalam: { lagi: 'ya', angka: 0 } } });
  await db.collection('students').doc('s2').set({ name: 'Siti', guru: ref, besar: 9007199254740991, nan: Number.NaN });
  await db.collection('assignments').doc('a/1'.replace('/', '_')).set({ title: 'Tugas 1', due: Timestamp.fromMillis(1_800_000_000_000) });
  await db.collection('grades').doc('g1').set({});
  await ref.collection('catatan').doc('c1').set({ isi: 'subkoleksi' });
}

beforeAll(async () => {
  if (!EMU) throw new Error('Butuh Firestore Emulator (jalankan lewat npm run test:rules).');
  await Promise.all([wipe(SRC), wipe(DST)]);
  await seed(dbOf(SRC));
  // Export konsisten memakai readTime = sekarang − 5 dtk; tunggu agar data seed ikut terbaca.
  await new Promise((r) => setTimeout(r, 6500));
}, 30000);
afterAll(async () => { await Promise.all([wipe(SRC), wipe(DST)]); });

describe('export → enkripsi → restore ke proyek terpisah', () => {
  it('hasil restore identik (sidik jari isi) dan tipe data terjaga', async () => {
    const src = dbOf(SRC);
    const { ndjson, manifest } = await exportFirestore(src, { projectId: SRC, recursive: true });
    expect(manifest.collections).toEqual({ students: 3, assignments: 1, grades: 1 }); // 2 siswa + 1 dokumen subkoleksi (dihitung di akar)
    const sealed = sealBackup(ndjson, KEY);
    expect(sealed.includes(Buffer.from('Budi Santoso'))).toBe(false); // terenkripsi: tidak ada teks polos
    const parsed = parseBackup(openBackup(sealed, KEY));
    const summary = await restoreInto(dbOf(DST), parsed, { apply: true });
    expect(summary.written).toBe(parsed.docs.length);

    const dst = dbOf(DST);
    expect(await fingerprint(dst, { recursive: true })).toEqual(await fingerprint(src, { recursive: true }));
    const s1 = (await dst.collection('students').doc('s1').get()).data()!;
    expect(s1.created).toBeInstanceOf(Timestamp);
    expect((s1.created as Timestamp).toMillis()).toBe(1_700_000_123_456);
    expect(s1.lokasi).toBeInstanceOf(GeoPoint);
    expect([...(s1.foto as Buffer)]).toEqual([0, 1, 2, 255]);
    expect(s1.__t).toBe('bukan-tipe');
    expect(s1.kosong).toBeNull();
    expect(s1.unik).toBe('Ünïcödé 🎓');
    expect(s1.tags).toEqual(['a', 1, { x: [true] }]);
    const s2 = (await dst.collection('students').doc('s2').get()).data()!;
    expect(s2.guru.path).toBe('students/s1'); // referensi dokumen dipulihkan sebagai referensi (di proyek tujuan)
    expect(Number.isNaN(s2.nan)).toBe(true);
    expect((await dst.collection('students').doc('s1').collection('catatan').doc('c1').get()).data()).toEqual({ isi: 'subkoleksi' });
    expect((await dst.collection('grades').doc('g1').get()).exists).toBe(true); // dokumen kosong tetap ada
  });

  it('dry-run tidak menulis apa pun', async () => {
    await wipe(DST);
    const { ndjson } = await exportFirestore(dbOf(SRC), { projectId: SRC });
    const r = await restoreInto(dbOf(DST), parseBackup(ndjson), { apply: false });
    expect(r).toMatchObject({ applied: false, written: 0 });
    expect((await dbOf(DST).collection('students').get()).size).toBe(0);
  });

  it('kunci salah, berkas diubah, terpotong, atau manifest tidak cocok → ditolak (bukan restore diam-diam)', async () => {
    const { ndjson } = await exportFirestore(dbOf(SRC), { projectId: SRC });
    const sealed = sealBackup(ndjson, KEY);
    expect(() => openBackup(sealed, 'kunci-lain-yang-juga-panjang')).toThrow(/kunci salah|rusak/);
    const flipped = Buffer.from(sealed); flipped[flipped.length - 40] ^= 1;
    expect(() => openBackup(flipped, KEY)).toThrow(/kunci salah|rusak/);
    expect(() => openBackup(Buffer.from('bukan backup sama sekali, cuma teks'), KEY)).toThrow(/bukan backup/);
    const lines = ndjson.toString().split('\n').filter(Boolean);
    expect(() => parseBackup(Buffer.from(lines.slice(0, -1).join('\n') + '\n'))).toThrow(/Manifest|manifest/); // manifest hilang
    const noDoc = [...lines.slice(1)].join('\n') + '\n'; // satu dokumen hilang
    expect(() => parseBackup(Buffer.from(noDoc))).toThrow(/Hash isi|Jumlah/);
    expect(() => sealBackup(ndjson, 'pendek')).toThrow(/16 karakter/);
  });

  it('melebihi BACKUP_MAX_DOCS → dibatalkan sebelum membaca dokumen (melindungi kuota baca aplikasi)', async () => {
    await expect(exportFirestore(dbOf(SRC), { projectId: SRC, maxDocs: 1 })).rejects.toThrow(/melebihi BACKUP_MAX_DOCS/);
  });
});

describe('CLI backup + restore (proses terpisah)', () => {
  it('backup --out lalu restore dengan penjagaan; hasil identik', async () => {
    const dir = mkdtemp();
    const file = path.join(dir, 'b.twb');
    const b = run('backup-to-drive.mjs', ['--out', file, '--project', SRC], cliEnv());
    expect(b.status, b.stderr).toBe(0);
    expect(b.stdout).toMatch(/dokumen/);
    expect(readFileSync(file).includes(Buffer.from('Budi'))).toBe(false);

    await wipe(DST);
    const dry = run('restore-from-backup.mjs', [file, '--project', DST], cliEnv());
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/DRY-RUN/);
    expect((await dbOf(DST).collection('students').get()).size).toBe(0);

    const real = run('restore-from-backup.mjs', [file, '--project', DST, '--apply'], cliEnv());
    expect(real.status, real.stderr).toBe(0);
    expect(real.stdout).toMatch(/EMULATOR/);
    expect(await fingerprint(dbOf(DST))).toEqual(await fingerprint(dbOf(SRC)));
  });

  it('restore ke Firestore NYATA ditolak tanpa konfirmasi eksplisit (tidak ada panggilan jaringan)', () => {
    const dir = mkdtemp();
    const file = path.join(dir, 'b.twb');
    expect(run('backup-to-drive.mjs', ['--out', file, '--project', SRC], cliEnv()).status).toBe(0);
    const noEmu = (extra: string[]) => run('restore-from-backup.mjs', [file, '--project', 'proyek-nyata', '--apply', ...extra], { ...cliEnv(), FIRESTORE_EMULATOR_HOST: '', FIREBASE_SERVICE_ACCOUNT: '{"x":1}' });
    expect(noEmu([]).stderr).toMatch(/--confirm-project/);
    expect(noEmu(['--confirm-project', 'lain']).stderr).toMatch(/--confirm-project/);
    // proyek asal = tujuan butuh bendera tambahan
    const same = run('restore-from-backup.mjs', [file, '--project', SRC, '--apply', '--confirm-project', SRC], { ...cliEnv(), FIRESTORE_EMULATOR_HOST: '', FIREBASE_SERVICE_ACCOUNT: '{"x":1}' });
    expect(same.stderr).toMatch(/allow-overwrite-source-project/);
    // kunci salah
    const wrongKey = run('restore-from-backup.mjs', [file, '--project', DST], cliEnv({ BACKUP_ENCRYPTION_KEY: 'kunci-yang-salah-tapi-panjang' }));
    expect(wrongKey.status).not.toBe(0);
    expect(wrongKey.stderr).toMatch(/kunci salah|rusak/);
  });

  it('jalur Drive penuh lewat server palsu: unggah terverifikasi MD5, retensi, tidak membocorkan secret', async () => {
    const drive = await startFakeDrive();
    try {
      const r = await runAsync('backup-to-drive.mjs', ['--project', SRC], cliEnv({ DRIVE_CLIENT_ID: 'cid', DRIVE_CLIENT_SECRET: 'RAHASIA-CS', DRIVE_REFRESH_TOKEN: 'rt', DRIVE_FAKE_BASE: drive.base }));
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/Drive \(MD5 terverifikasi\)/);
      expect(drive.files.filter((f) => f.name.startsWith('twbackup-'))).toHaveLength(1);
      const stored = drive.files.find((f) => f.name.startsWith('twbackup-'))!;
      expect(stored.parent).toBeTruthy();
      expect(parseBackup(openBackup(stored.data, KEY)).manifest.projectId).toBe(SRC); // yang tersimpan di Drive benar-benar bisa dibuka
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/RAHASIA-CS|kunci-uji-backup/);

      // refresh token ditolak → pesan jelas tanpa membocorkan secret
      const bad = await runAsync('backup-to-drive.mjs', ['--project', SRC], cliEnv({ DRIVE_CLIENT_ID: 'cid', DRIVE_CLIENT_SECRET: 'RAHASIA-CS', DRIVE_REFRESH_TOKEN: 'kedaluwarsa', DRIVE_FAKE_BASE: drive.base }));
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toMatch(/invalid_grant/);
      expect(`${bad.stdout}${bad.stderr}`).not.toMatch(/RAHASIA-CS|kedaluwarsa/);
    } finally { drive.close(); }
  });

  it('database kosong / salah proyek → backup ditolak, bukan "sukses" semu', () => {
    const r = run('backup-to-drive.mjs', ['--out', path.join(mkdtemp(), 'x.twb'), '--project', 'demo-backup-kosong'], cliEnv());
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/0 dokumen/);
  });

  it('secret Drive/kunci enkripsi belum diisi → gagal jelas, bukan sukses semu', () => {
    const noKey = run('backup-to-drive.mjs', ['--project', SRC], { ...cliEnv(), BACKUP_ENCRYPTION_KEY: '' });
    expect(noKey.stderr).toMatch(/BACKUP_ENCRYPTION_KEY/);
    const noDrive = run('backup-to-drive.mjs', ['--project', SRC], cliEnv());
    expect(noDrive.status).not.toBe(0);
    expect(noDrive.stderr).toMatch(/Secret Drive belum lengkap/);
  });
});

describe('klien Drive & retensi', () => {
  it('unggah dengan MD5 berbeda dari lokal → ditolak', async () => {
    const drive = await startFakeDrive({ corruptMd5: true });
    try {
      const token = await getAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'rt' }, { endpoints: drive.endpoints });
      const c = driveClient(token, { endpoints: drive.endpoints });
      const folder = await c.ensureFolder('F');
      expect(await c.ensureFolder('F')).toBe(folder); // idempoten: tidak membuat folder ganda
      await expect(c.uploadVerified(folder, 'twbackup-20260101T000000Z.twb', Buffer.from('isi'))).rejects.toThrow(/Verifikasi unggahan gagal/);
    } finally { drive.close(); }
  });

  it('retensi: simpan harian terbaru + mingguan + bulanan; nama asing tak pernah dihapus', () => {
    const mk = (d: string, id = d) => ({ id, name: backupFilename(new Date(`${d}T14:00:00Z`)) });
    const files = [] as { id: string; name: string }[];
    for (let i = 0; i < 120; i++) files.push(mk(new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)));
    files.push({ id: 'asing', name: 'catatan-pribadi.txt' });
    const del = selectForDeletion(files);
    const kept = files.filter((f) => !del.includes(f));
    expect(kept.find((f) => f.id === 'asing')).toBeTruthy();
    const newest = files.slice(-15, -1).map((f) => f.id);
    for (const id of newest) expect(kept.some((f) => f.id === id)).toBe(true); // 14 harian terbaru utuh
    expect(kept.length).toBeLessThan(files.length / 2);
    expect(kept.length).toBeGreaterThanOrEqual(14 + 1);
    expect(selectForDeletion(files.slice(0, 5))).toEqual([]); // sedikit berkas → tidak ada yang dihapus
  });
});

// ---------- util tes ----------
function mkdtemp() { return mkdtempSync(path.join(tmpdir(), 'twb-')); }
type FakeFile = { id: string; name: string; parent: string; data: Buffer };
async function startFakeDrive(opts: { corruptMd5?: boolean } = {}) {
  const files: FakeFile[] = [];
  const folders: { id: string; name: string }[] = [];
  let n = 0;
  let base = '';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const json = (code: number, o: unknown, h: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/token') return new URLSearchParams(body.toString()).get('refresh_token') === 'rt' ? json(200, { access_token: 'at' }) : json(400, { error: 'invalid_grant' });
    if (req.headers.authorization !== 'Bearer at' && url.pathname !== '/upload/session') return json(401, { error: 'x' });
    if (req.method === 'GET' && url.pathname === '/drive/files') {
      const q = url.searchParams.get('q') ?? '';
      if (q.includes('google-apps.folder')) { const name = q.match(/name='(.*?)'/)?.[1]; return json(200, { files: folders.filter((f) => f.name === name) }); }
      const parent = q.match(/'(.*?)' in parents/)?.[1];
      return json(200, { files: files.filter((f) => f.parent === parent).map((f) => ({ id: f.id, name: f.name, size: String(f.data.length) })) });
    }
    if (req.method === 'POST' && url.pathname === '/drive/files') { const f = { id: `folder${++n}`, name: JSON.parse(body.toString()).name }; folders.push(f); return json(200, { id: f.id }); }
    if (req.method === 'POST' && url.pathname === '/upload/files') { const meta = JSON.parse(body.toString()); return json(200, {}, { location: `${base}/upload/session?name=${encodeURIComponent(meta.name)}&parent=${meta.parents[0]}` }); }
    if (req.method === 'PUT' && url.pathname === '/upload/session') {
      const f = { id: `file${++n}`, name: url.searchParams.get('name') ?? '', parent: url.searchParams.get('parent') ?? '', data: body };
      files.push(f);
      const md5 = opts.corruptMd5 ? '0'.repeat(32) : createHash('md5').update(body).digest('hex');
      return json(200, { id: f.id, size: String(body.length), md5Checksum: md5 });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/drive/files/')) { const i = files.findIndex((f) => f.id === url.pathname.split('/').pop()); if (i >= 0) files.splice(i, 1); res.writeHead(204); return res.end(); }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, files, endpoints: { token: `${base}/token`, api: `${base}/drive`, upload: `${base}/upload` }, close: () => server.close() };
}
