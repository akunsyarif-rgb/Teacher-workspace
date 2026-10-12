/**
 * E2E browser Backup & Ekspor Data (build produksi di Chromium + Firebase Emulator auth/firestore/storage):
 * guru mendaftar → menu Akun → Backup & Ekspor Data → unduh terenkripsi/tidak → arsip didekripsi, diverifikasi, dan dipulihkan ke
 * proyek emulator TERPISAH. Juga: isolasi dua guru berbeda workspace, kegagalan jaringan, tanpa token → 401.
 * Bukan bukti terhadap Firebase/Supabase/Drive nyata.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { decryptArchive, isEncryptedArchive } from '../../lib/backup/archiveCrypto.mjs';
import { verifyExportZip } from '../../lib/backup/archive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_URL = 'http://127.0.0.1:3100';
const PASS = 'rahasia123';
const ARCHIVE_PASS = 'sandi-arsip-guru-1';
const steps = [];
const pass = (name, detail = '') => { steps.push({ name, ok: true }); console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail) => { steps.push({ name, ok: false }); console.log(`  ✗ ${name} — ${detail}`); };
const check = (c, name, detail = '') => (c ? pass(name, detail) : fail(name, detail || 'kondisi tidak terpenuhi'));

const APP_ENV = {
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true', NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-teacher-workspace.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-teacher-workspace', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-teacher-workspace.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000', NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:demo',
  BACKUP_COOLDOWN_SECONDS: '0',
};
const taken = (port) => new Promise((r) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.end(); r(true); }); s.on('error', () => r(false)); });

async function startApp() {
  if (await taken(3100)) throw new Error('Port 3100 sudah dipakai proses lain.');
  if (process.env.E2E_SKIP_BUILD !== 'true') {
    console.log('→ Build aplikasi (mode emulator)...');
    await new Promise((resolve, reject) => {
      const b = spawn('npx', ['next', 'build'], { env: { ...process.env, ...APP_ENV }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; b.stderr.on('data', (c) => (err += c));
      b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next build gagal:\n${err.slice(-2000)}`))));
    });
  }
  const server = spawn('npx', ['next', 'start', '--port', '3100', '--hostname', '127.0.0.1'], { env: { ...process.env, ...APP_ENV }, stdio: 'ignore', detached: true });
  for (let i = 0; i < 90; i++) { try { const r = await fetch(BASE_URL); if (r.ok || r.status === 404) return server; } catch { /* belum siap */ } await sleep(1000); }
  throw new Error('Next.js tidak siap dalam 90 detik.');
}
const stopServer = (s) => { try { process.kill(-s.pid, 'SIGTERM'); } catch { try { s.kill('SIGKILL'); } catch { /* mati */ } } };

async function signupWithStudent(page, email, studentName, className) {
  await page.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[placeholder="Minimal 6 karakter"]', PASS);
  await page.fill('input[placeholder="Ulangi kata sandi"]', PASS);
  await page.fill('input[placeholder*="Kelas Pak"]', `WS ${studentName}`);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
  await page.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
  const form = page.locator('form').first();
  await form.locator('input').nth(0).fill(studentName, { timeout: 20000 });
  await form.locator('input').nth(1).fill('12345');
  await form.locator('input[placeholder*="TEKNIK"]').fill(className);
  await page.getByRole('button', { name: /Simpan Siswa/i }).click();
  await page.waitForTimeout(4000);
}

async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), trigger()]);
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'twbk-')), dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename(), bytes: readFileSync(file) };
}

async function run() {
  const server = await startApp();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const t1 = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const t2 = await (await browser.newContext({ acceptDownloads: true })).newPage();
  const pageErrors = [];
  t1.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    console.log('\n→ Persiapan (dua guru, dua workspace)');
    await signupWithStudent(t1, `guru1-${Date.now()}@contoh.sch.id`, 'Budi Santoso', 'XI-A');
    await signupWithStudent(t2, `guru2-${Date.now()}@contoh.sch.id`, 'Citra Dewi', 'X-B');
    pass('Dua guru mendaftar dan masing-masing punya satu siswa');

    console.log('\n→ Menu dan formulir');
    // Jalur penemuan nyata: Beranda → ikon "Akun" → menu Backup terlihat (juga di layar iPhone 390 px).
    await t1.setViewportSize({ width: 390, height: 844 });
    await t1.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await t1.getByRole('link', { name: 'Akun', exact: true }).click({ timeout: 30000 });
    await t1.waitForURL(`${BASE_URL}/account`, { timeout: 15000 });
    const menu = t1.getByRole('link', { name: /Backup & Ekspor Data/ });
    await menu.waitFor({ state: 'visible', timeout: 20000 });
    await menu.scrollIntoViewIfNeeded();
    const mb = await menu.boundingBox();
    check(!!mb && mb.x >= 0 && mb.x + mb.width <= 390 && (await menu.isVisible()), 'Beranda → ikon Akun → menu "Backup & Ekspor Data" terlihat penuh di layar 390 px, tanpa kondisi/flag');
    check((await t1.getByRole('link', { name: /Backup & Ekspor Data/ }).count()) === 1, 'Tepat satu tautan menu Backup (tidak duplikat)');
    await t1.setViewportSize({ width: 1280, height: 720 });
    await t1.getByRole('link', { name: /Backup & Ekspor Data/ }).click({ timeout: 30000 });
    await t1.waitForURL(`${BASE_URL}/account/backup`, { timeout: 15000 });
    await t1.getByRole('heading', { name: /Backup & Ekspor Data/ }).waitFor({ timeout: 20000 });
    pass('Menu Akun → Backup & Ekspor Data terbuka');
    const btn = t1.getByRole('button', { name: /Unduh Backup/ });
    check(await btn.isDisabled(), 'Tombol Unduh nonaktif sampai kata sandi sah diisi (enkripsi default aktif)');
    await t1.getByPlaceholder(/Kata sandi arsip/).fill(ARCHIVE_PASS);
    await t1.getByPlaceholder('Ulangi kata sandi').fill('beda-sandi-xx');
    check((await t1.getByText('Konfirmasi kata sandi tidak sama.').count()) === 1 && (await btn.isDisabled()), 'Konfirmasi sandi tidak sama → pesan jelas, tombol tetap nonaktif');
    await t1.getByPlaceholder('Ulangi kata sandi').fill(ARCHIVE_PASS);
    check(await btn.isEnabled(), 'Sandi sah → tombol aktif');

    console.log('\n→ Unduh terenkripsi, verifikasi, dan pulihkan');
    const enc = await download(t1, () => btn.click());
    check(/^teacher-workspace-backup-\d{8}-\d{4}\.zip\.enc$/.test(enc.name), 'Berkas unduhan bernama jelas (.zip.enc)', enc.name);
    check(isEncryptedArchive(enc.bytes) && !enc.bytes.includes(Buffer.from('Budi')), 'Berkas terenkripsi: tidak ada teks polos data siswa');
    await t1.getByTestId('backup-result').waitFor({ timeout: 20000 });
    const panel = await t1.getByTestId('backup-result').innerText();
    check(/Backup berhasil diunduh/.test(panel) && /BELUM mencakup semuanya/.test(panel) && /students\s*1/.test(panel.replace(/\n/g, ' ')), 'UI menampilkan hasil, jumlah per koleksi, dan peringatan cakupan tidak lengkap', panel.replace(/\s+/g, ' ').slice(0, 120));
    if (process.env.E2E_SHOT_DIR) { await t1.setViewportSize({ width: 390, height: 844 }); await t1.screenshot({ path: path.join(process.env.E2E_SHOT_DIR, 'backup-hasil-iphone.png'), fullPage: true }); await t1.setViewportSize({ width: 1280, height: 720 }); }
    const zip = Buffer.from(await decryptArchive(ARCHIVE_PASS, new Uint8Array(enc.bytes)));
    const v1 = verifyExportZip(zip);
    check(v1.docs.some((d) => d.p.startsWith('students/') && JSON.stringify(d.d).includes('Budi Santoso')) && !JSON.stringify(v1.docs).includes('Citra'), 'Arsip valid: berisi siswa guru 1 dan TIDAK berisi data guru 2');
    check(v1.manifest.coverage.overall === 'sebagian' && v1.manifest.ulangan.status === 'not_enabled', 'Manifest jujur: cakupan "sebagian", Ulangan tidak aktif', `${v1.manifest.coverage.overall}/${v1.manifest.ulangan.status}`);
    let wrong = false; try { await decryptArchive('sandi-salah-xyz', new Uint8Array(enc.bytes)); } catch { wrong = true; }
    check(wrong, 'Kata sandi salah tidak dapat membuka arsip');
    const plainZip = path.join(path.dirname(enc.file), 'dekripsi.zip');
    writeFileSync(plainZip, zip);
    const cli = (args, env = {}) => spawnSync('node', [path.join(ROOT, 'scripts/backup/restore-export.mjs'), ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST, ...env }, encoding: 'utf8', cwd: ROOT });
    const dry = cli([enc.file, '--project', 'demo-restore-e2e'], { BACKUP_PASSPHRASE: ARCHIVE_PASS });
    check(dry.status === 0 && /Arsip VALID/.test(dry.stdout) && /VERIFIKASI SAJA/.test(dry.stdout), 'Skrip restore memverifikasi arsip terenkripsi (dry-run, tidak menulis)', dry.stderr.slice(0, 100));
    const real = cli([enc.file, '--project', 'demo-restore-e2e', '--apply'], { BACKUP_PASSPHRASE: ARCHIVE_PASS });
    const total = v1.manifest.firestore.totalDocs;
    check(real.status === 0 && new RegExp(`${total}/${total} dokumen`).test(real.stdout), `Restore ke proyek emulator TERPISAH: ${total}/${total} dokumen`, real.stdout.trim().split('\n').pop());

    // Pembuka arsip terenkripsi ada di panel bantuan OPSIONAL (tertutup secara bawaan); dekripsi di perangkat, sandi tidak dikirim ke server.
    const help = t1.locator('details', { hasText: 'membuka backup terenkripsi' });
    check((await help.count()) === 1 && (await help.evaluate((el) => !el.open)), 'Pembuka arsip berada di panel bantuan opsional yang tertutup secara bawaan');
    await help.locator('summary').click();
    check(await help.evaluate((el) => el.open), 'Panel bantuan dapat dibuka');
    for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
      await t1.setViewportSize(vp);
      const fileInput = t1.getByLabel('Pilih file backup terenkripsi (.zip.enc)');
      await fileInput.scrollIntoViewIfNeeded();
      const fb = await fileInput.boundingBox();
      const overflow = await t1.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(await fileInput.isVisible() && !!fb && fb.x >= 0 && fb.x + fb.width <= vp.width + 1 && !overflow, `Pemilih file terlihat dan muat di layar ${vp.width} px (tanpa gulir horizontal)`);
    }
    check((await help.getByText(/Pilih file tersebut, lalu masukkan kata sandi yang sama/).isVisible()) && (await help.getByText(/tidak dikirim ke server/).isVisible()), 'Instruksi pembuka arsip jelas terlihat (file, kata sandi yang sama, dekripsi di perangkat)');
    const sent = [];
    t1.on('request', (r) => sent.push(`${r.url()}\n${JSON.stringify(r.headers())}\n${r.postData() ?? ''}`));
    await t1.getByLabel('Pilih file backup terenkripsi (.zip.enc)').setInputFiles(enc.file);
    await t1.getByLabel('Kata sandi untuk membuka arsip').fill('sandi-salah-xyz');
    await t1.getByRole('button', { name: 'Dekripsi & Unduh ZIP' }).click();
    await t1.getByText(/kata sandi salah/i).waitFor({ timeout: 20000 });
    pass('Buka arsip di aplikasi: kata sandi salah ditolak dengan pesan jelas');
    await t1.getByLabel('Kata sandi untuk membuka arsip').fill(ARCHIVE_PASS);
    const opened = await download(t1, () => t1.getByRole('button', { name: 'Dekripsi & Unduh ZIP' }).click());
    check(opened.name === enc.name.replace(/\.enc$/, '') && Buffer.compare(opened.bytes, zip) === 0, 'Buka arsip di aplikasi: kata sandi benar → ZIP asli identik byte-per-byte', opened.name);
    check(opened.bytes.subarray(0, 4).toString('hex') === '504b0304' && verifyExportZip(opened.bytes).manifest.format !== undefined, 'Hasil dekripsi adalah ZIP valid (tanda PK + lolos verifikasi penuh)');
    check(!sent.some((x) => x.includes(ARCHIVE_PASS) || x.includes('sandi-salah-xyz') || x.includes(encodeURIComponent(ARCHIVE_PASS))), 'Kata sandi dan isi pembukaan arsip tidak dikirim ke server (tidak ada permintaan jaringan yang memuatnya)', `${sent.length} permintaan`);
    t1.removeAllListeners('request');

    console.log('\n→ Tanpa enkripsi, isolasi antar workspace');
    await t1.getByRole('checkbox').first().uncheck();
    check((await t1.getByText(/Tanpa kata sandi, siapa pun/).count()) === 1 && (await btn.isEnabled()), 'Tanpa enkripsi: peringatan risiko tampil');
    const plain = await download(t1, () => btn.click());
    check(/\.zip$/.test(plain.name) && !plain.name.endsWith('.enc'), 'Berkas tidak terenkripsi berekstensi .zip');
    const vPlain = verifyExportZip(plain.bytes);
    check(vPlain.manifest.firestore.collections.students.count === 1, 'ZIP tanpa enkripsi sah dan lolos verifikasi penuh (CRC + SHA-256 + jumlah)');
    await t2.goto(`${BASE_URL}/account/backup`, { waitUntil: 'domcontentloaded' });
    await t2.getByRole('checkbox').first().uncheck();
    const d2 = await download(t2, () => t2.getByRole('button', { name: /Unduh Backup/ }).click());
    const v2 = verifyExportZip(d2.bytes);
    check(JSON.stringify(v2.docs).includes('Citra Dewi') && !JSON.stringify(v2.docs).includes('Budi Santoso') && v2.manifest.workspace.id !== v1.manifest.workspace.id, 'Guru 2 hanya mendapat data workspace-nya sendiri (isolasi terbukti lewat alur nyata)');

    console.log('\n→ Kegagalan');
    await t1.route('**/api/backup/export', (r) => r.abort());
    await t1.getByRole('button', { name: /Unduh Backup/ }).click();
    await t1.getByText(/Tidak dapat terhubung ke server/).waitFor({ timeout: 20000 });
    check(await t1.getByRole('button', { name: /Unduh Backup/ }).isEnabled(), 'Jaringan putus: pesan jelas dan tombol bisa dicoba lagi (tidak ada arsip setengah jadi)');
    await t1.unroute('**/api/backup/export');
    await t1.getByRole('button', { name: /Unduh Backup/ }).click();
    await t1.getByTestId('backup-result').waitFor({ timeout: 30000 });
    pass('Setelah jaringan pulih, unduhan berikutnya berhasil');
    const anon = await t1.evaluate(async () => { const r = await fetch('/api/backup/export', { method: 'POST' }); return { status: r.status, body: await r.text() }; });
    check(anon.status === 401 && !/zip|PK/.test(anon.body.slice(0, 20)), 'Tanpa token → 401 (tidak ada arsip)', String(anon.status));
    const bad = await t1.evaluate(async () => { const r = await fetch('/api/backup/export', { method: 'POST', headers: { Authorization: 'Bearer palsu.palsu.palsu' } }); return r.status; });
    check(bad === 401, 'Token tidak valid → 401', String(bad));

    console.log('\n→ Lampiran');
    await t1.getByRole('button', { name: 'Unduh Lampiran' }).click();
    await t1.getByText(/Tidak ada lampiran tugas di Supabase/).first().waitFor({ timeout: 30000 });
    pass('Workspace tanpa lampiran: pesan jelas, tidak ada unduhan kosong');
    check(pageErrors.length === 0, 'Tidak ada pageerror JavaScript di browser', pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('Alur e2e', e instanceof Error ? e.message.split('\n')[0] : String(e));
    for (const [l, p] of [['guru1', t1], ['guru2', t2]]) { try { await p.screenshot({ path: `/tmp/e2e-backup-${l}.png`, fullPage: true }); console.log(`  (layar ${l}: /tmp/e2e-backup-${l}.png)`); } catch { /* ditutup */ } }
  } finally { await browser.close(); stopServer(server); }
  const bad = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - bad.length}/${steps.length} langkah lolos`);
  process.exit(bad.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
