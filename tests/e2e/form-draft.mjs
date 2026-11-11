/**
 * Regression test: draf formulir (jurnal, pengumuman, tugas) tidak hilang saat halaman dimuat ulang.
 *
 * Spec "Proteksi Tinggi" menuntut nilai yang sudah terkunci TIDAK boleh
 * langsung bisa diketik ulang hanya karena ikon pensilnya tersentuh — di
 * layar sentuh itu gampang terjadi tanpa disengaja. Harus muncul dialog
 * "Ubah nilai?" dengan pilihan Batal / Lanjutkan, dan Batal harus benar-
 * benar membiarkan nilai tetap terkunci.
 *
 * Jalankan: npm run test:e2e:form-draft
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3100';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const STUDENT_NAME = 'Siswa Uji Form';
const CLASS_NAME = 'X-FORM-1';
const COLUMN_TITLE = 'Ulangan Harian 1';
const FIRST_SCORE = '75';
const CORRECTED_SCORE = '90';

const steps = [];
function pass(name, detail = '') {
  steps.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  steps.push({ name, ok: false, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}

async function failWithEvidence(page, name, detail) {
  let evidence = detail;
  try {
    const file = `/tmp/e2e-draf-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
    evidence = `${detail} | layar: ${file} | teks halaman: "${text}"`;
  } catch {
    // halaman mungkin sudah tertutup
  }
  fail(name, evidence);
}

const APP_ENV = {
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-teacher-workspace.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-teacher-workspace',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-teacher-workspace.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:demo',
};

function isPortTaken(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.on('connect', () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false); });
  });
}

async function buildApp() {
  if (process.env.E2E_SKIP_BUILD === 'true') {
    console.log('→ Melewati build (E2E_SKIP_BUILD=true), memakai build yang ada.');
    return;
  }
  console.log('→ Build aplikasi (mode emulator)...');
  await new Promise((resolve, reject) => {
    const build = spawn('npx', ['next', 'build'], {
      env: { ...process.env, ...APP_ENV },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    build.stderr?.on('data', (chunk) => (stderr += chunk));
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-2000)))));
  });
}

async function startAppServer() {
  if (await isPortTaken(3100)) throw new Error('Port 3100 sudah dipakai proses lain.');
  await buildApp();
  console.log('→ Menjalankan server produksi di :3100...');
  const server = spawn('npx', ['next', 'start', '--port', '3100', '--hostname', '127.0.0.1'], {
    env: { ...process.env, ...APP_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.status < 500) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return server;
}

function stopServer(server) {
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}

async function run() {
  const server = await startAppServer();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const teacher = await (await browser.newContext()).newPage();
  const url = (tab) => `${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=${tab}`;
  const reload = async () => { await teacher.reload({ waitUntil: 'domcontentloaded' }); await teacher.waitForTimeout(3500); };

  try {
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji Form');
    await teacher.check('input[name="consent"]');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('9301');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(3000);
    pass('Setup: guru, kelas, dan siswa siap', CLASS_NAME);

    // ---------- Jurnal ----------
    await teacher.goto(url('jurnal'), { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(3000);
    await teacher.fill('input[placeholder*="Hukum Tajwid"]', 'Bab Pecahan');
    await teacher.fill('textarea[placeholder*="Catat aktivitas"]', 'Siswa aktif bertanya');
    await teacher.waitForTimeout(500);
    await reload();
    const topicBack = await teacher.locator('input[placeholder*="Hukum Tajwid"]').inputValue().catch(() => null);
    const notesBack = await teacher.locator('textarea[placeholder*="Catat aktivitas"]').inputValue().catch(() => null);
    if (topicBack === 'Bab Pecahan' && notesBack === 'Siswa aktif bertanya' && (await teacher.getByTestId('journal-draft-notice').count()) > 0)
      pass('Jurnal: draf dipulihkan setelah muat ulang (dengan pemberitahuan)');
    else await failWithEvidence(teacher, 'Jurnal: draf dipulihkan setelah muat ulang (dengan pemberitahuan)', `topik=${topicBack}, catatan=${notesBack}`);

    await teacher.getByRole('button', { name: /Simpan Jurnal Mengajar/i }).click();
    await teacher.waitForTimeout(3000);
    await reload();
    if ((await teacher.getByTestId('journal-draft-notice').count()) === 0 && (await teacher.getByText('Bab Pecahan').count()) > 0)
      pass('Jurnal: setelah Simpan, draf hilang dan jurnal tampil tersimpan');
    else await failWithEvidence(teacher, 'Jurnal: setelah Simpan, draf hilang dan jurnal tampil tersimpan', 'draf masih ada atau jurnal tidak tampil');

    // ---------- Pengumuman ----------
    await teacher.goto(url('pengumuman'), { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(2500);
    await teacher.getByRole('button', { name: /Buat Pengumuman/i }).first().click();
    await teacher.fill('input[placeholder*="Ulangan Bab 3"]', 'Ulangan Senin');
    await teacher.fill('textarea[placeholder*="Tulis pengumuman"]', 'Bawa kalkulator');
    await teacher.getByRole('button', { name: /^Batal$/i }).first().click(); // tutup tanpa kirim
    await teacher.waitForTimeout(400);
    await reload();
    const annNotice = await teacher.getByTestId('announcement-draft-notice').count();
    await teacher.getByRole('button', { name: /Buat Pengumuman/i }).first().click();
    const annTitle = await teacher.locator('input[placeholder*="Ulangan Bab 3"]').inputValue().catch(() => null);
    const annBody = await teacher.locator('textarea[placeholder*="Tulis pengumuman"]').inputValue().catch(() => null);
    if (annNotice > 0 && annTitle === 'Ulangan Senin' && annBody === 'Bawa kalkulator') pass('Pengumuman: draf yang ditutup tanpa dikirim tetap ada setelah muat ulang');
    else await failWithEvidence(teacher, 'Pengumuman: draf yang ditutup tanpa dikirim tetap ada setelah muat ulang', `spanduk=${annNotice}, judul=${annTitle}, isi=${annBody}`);
    await teacher.getByRole('button', { name: /^Batal$/i }).first().click();

    // ---------- Tugas ----------
    await teacher.goto(url('tugas'), { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(2500);
    await teacher.getByRole('button', { name: /Buat Tugas/i }).first().click();
    await teacher.fill('input[placeholder*="Latihan Soal Bab 3"]', 'Latihan Pecahan');
    await teacher.fill('textarea[placeholder*="Jelaskan apa"]', 'Kerjakan no 1-10');
    await teacher.waitForTimeout(500);
    await reload();
    await teacher.getByRole('button', { name: /Buat Tugas/i }).first().click();
    await teacher.waitForTimeout(500);
    const tTitle = await teacher.locator('input[placeholder*="Latihan Soal Bab 3"]').inputValue().catch(() => null);
    const tDesc = await teacher.locator('textarea[placeholder*="Jelaskan apa"]').inputValue().catch(() => null);
    if (tTitle === 'Latihan Pecahan' && tDesc === 'Kerjakan no 1-10' && (await teacher.getByTestId('assignment-draft-notice').count()) > 0)
      pass('Tugas: draf judul & instruksi dipulihkan setelah muat ulang');
    else await failWithEvidence(teacher, 'Tugas: draf judul & instruksi dipulihkan setelah muat ulang', `judul=${tTitle}, instruksi=${tDesc}`);

    // ---------- Keluar akun menghapus draf (dengan konfirmasi) ----------
    let confirmText = '';
    teacher.once('dialog', async (d) => { confirmText = d.message(); await d.dismiss(); });
    await teacher.goto(`${BASE_URL}/account`, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(2500);
    const logout = teacher.getByRole('button', { name: /keluar/i }).first();
    if (await logout.count()) {
      await logout.click().catch(() => {});
      await teacher.waitForTimeout(600);
      if (/belum disimpan/i.test(confirmText)) pass('Keluar akun memperingatkan ada isian yang belum disimpan');
      else await failWithEvidence(teacher, 'Keluar akun memperingatkan ada isian yang belum disimpan', `dialog="${confirmText}"`);
    } else {
      await failWithEvidence(teacher, 'Keluar akun memperingatkan ada isian yang belum disimpan', 'tombol Keluar tidak ditemukan di /account');
    }
  } finally {
    await browser.close();
    stopServer(server);
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} langkah lulus.`);
  if (failed.length) {
    console.log('Gagal:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
