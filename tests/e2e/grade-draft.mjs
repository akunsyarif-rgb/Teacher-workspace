/**
 * Regression test: draf nilai yang belum disimpan tidak hilang saat halaman dimuat ulang.
 *
 * Spec "Proteksi Tinggi" menuntut nilai yang sudah terkunci TIDAK boleh
 * langsung bisa diketik ulang hanya karena ikon pensilnya tersentuh — di
 * layar sentuh itu gampang terjadi tanpa disengaja. Harus muncul dialog
 * "Ubah nilai?" dengan pilihan Batal / Lanjutkan, dan Batal harus benar-
 * benar membiarkan nilai tetap terkunci.
 *
 * Jalankan: npm run test:e2e:grade-draft
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3100';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const STUDENT_NAME = 'Siswa Uji Draf';
const CLASS_NAME = 'X-DRAF-1';
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
  const CELL = `input[aria-label="Nilai ${STUDENT_NAME} - ${COLUMN_TITLE}"]`;
  const GRADES_URL = `${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=nilai`;

  try {
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji Draf');
    await teacher.check('input[name="consent"]');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    pass('Setup: guru mendaftar');

    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('9201');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(3000);
    pass('Setup: kelas + siswa dibuat', CLASS_NAME);

    await teacher.goto(GRADES_URL, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(2500);
    await teacher.getByRole('button', { name: /Tambah Kolom/i }).click();
    await teacher.waitForTimeout(500);
    await teacher.fill('input[placeholder*="Berpikir Kritis"]', COLUMN_TITLE);
    await teacher.getByRole('button', { name: /Tambahkan Kolom/i }).click();
    await teacher.waitForTimeout(2500);
    pass('Setup: kolom nilai dibuat', COLUMN_TITLE);

    // ---------- Ketik nilai, JANGAN simpan, muat ulang halaman ----------
    const input = teacher.locator(CELL).first();
    if (!(await input.count())) {
      await failWithEvidence(teacher, 'Sel nilai tersedia', 'sel input nilai tidak ditemukan');
      return;
    }
    await input.fill(FIRST_SCORE);
    await teacher.waitForTimeout(500);
    await teacher.reload({ waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(3500);

    const restored = teacher.locator(CELL).first();
    const value = (await restored.count()) ? await restored.inputValue() : null;
    if (value === FIRST_SCORE) pass('Nilai yang belum disimpan tetap ada setelah halaman dimuat ulang', FIRST_SCORE);
    else await failWithEvidence(teacher, 'Nilai yang belum disimpan tetap ada setelah halaman dimuat ulang', `nilai=${value}`);

    const notice = await teacher.getByTestId('grade-draft-notice').count();
    if (notice > 0) pass('Spanduk "dipulihkan dari perangkat ini" tampil');
    else await failWithEvidence(teacher, 'Spanduk "dipulihkan dari perangkat ini" tampil', 'spanduk tidak ada');

    const draftStyled = await restored.evaluate((el) => /amber/.test(el.className)).catch(() => false);
    if (draftStyled) pass('Sel tampil dengan warna Draft (belum disimpan)');
    else await failWithEvidence(teacher, 'Sel tampil dengan warna Draft (belum disimpan)', 'kelas warna amber tidak ada');

    const reviewLabel = await teacher.getByRole('button', { name: /Review & Simpan \(1\)/i }).count();
    if (reviewLabel > 0) pass('Tombol Review & Simpan menghitung 1 perubahan');
    else await failWithEvidence(teacher, 'Tombol Review & Simpan menghitung 1 perubahan', 'tombol tidak menunjukkan (1)');

    // ---------- Simpan → draf hilang ----------
    await teacher.getByRole('button', { name: /Review & Simpan/i }).click();
    await teacher.waitForTimeout(600);
    await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).click();
    await teacher.waitForTimeout(3000);
    await teacher.reload({ waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(3500);
    const noticeAfter = await teacher.getByTestId('grade-draft-notice').count();
    const lockedValue = await teacher.getByText(FIRST_SCORE, { exact: true }).count();
    if (noticeAfter === 0 && lockedValue > 0) pass('Setelah Simpan, nilai terkunci dan tidak ada draf lagi');
    else await failWithEvidence(teacher, 'Setelah Simpan, nilai terkunci dan tidak ada draf lagi', `spanduk=${noticeAfter}, nilai=${lockedValue}`);

    // ---------- Koreksi nilai terkunci, tidak disimpan, muat ulang ----------
    await teacher.locator(`button[aria-label*="Edit nilai ${STUDENT_NAME}"]`).first().click();
    await teacher.waitForTimeout(500);
    await teacher.getByRole('button', { name: /^Lanjutkan$/i }).first().click();
    await teacher.waitForTimeout(500);
    await teacher.locator(CELL).first().fill(CORRECTED_SCORE);
    await teacher.waitForTimeout(500);
    await teacher.reload({ waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(3500);
    const corr = teacher.locator(CELL).first();
    const corrValue = (await corr.count()) ? await corr.inputValue() : null;
    if (corrValue === CORRECTED_SCORE) pass('Koreksi nilai terkunci yang belum disimpan juga dipulihkan', CORRECTED_SCORE);
    else await failWithEvidence(teacher, 'Koreksi nilai terkunci yang belum disimpan juga dipulihkan', `nilai=${corrValue}`);

    // ---------- Buang draf ----------
    await teacher.getByRole('button', { name: /Buang draf/i }).click();
    await teacher.waitForTimeout(600);
    const backLocked = (await teacher.locator(CELL).count()) === 0 && (await teacher.getByText(FIRST_SCORE, { exact: true }).count()) > 0;
    if (backLocked) pass('Buang draf mengembalikan nilai tersimpan', FIRST_SCORE);
    else await failWithEvidence(teacher, 'Buang draf mengembalikan nilai tersimpan', 'sel tidak kembali ke nilai tersimpan');
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
