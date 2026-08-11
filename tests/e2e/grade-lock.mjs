/**
 * Regression test: gerbang konfirmasi "Ubah nilai?" pada nilai terkunci.
 *
 * Spec "Proteksi Tinggi" menuntut nilai yang sudah terkunci TIDAK boleh
 * langsung bisa diketik ulang hanya karena ikon pensilnya tersentuh — di
 * layar sentuh itu gampang terjadi tanpa disengaja. Harus muncul dialog
 * "Ubah nilai?" dengan pilihan Batal / Lanjutkan, dan Batal harus benar-
 * benar membiarkan nilai tetap terkunci.
 *
 * Jalankan: npm run test:e2e:grade-lock
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3100';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const STUDENT_NAME = 'Siswa Uji Nilai';
const CLASS_NAME = 'X-NILAI-1';
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
    const file = `/tmp/e2e-nilai-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const teacher = await (await browser.newContext()).newPage();

  try {
    // ---------- Setup: guru, kelas, siswa ----------
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji Nilai');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    pass('Setup: guru mendaftar');

    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('9101');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(3000);
    pass('Setup: kelas + siswa dibuat', CLASS_NAME);

    // ---------- Setup: kolom nilai ----------
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=nilai`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(2500);
    await teacher.getByRole('button', { name: /Tambah Kolom/i }).click();
    await teacher.waitForTimeout(500);
    await teacher.fill('input[placeholder*="Berpikir Kritis"]', COLUMN_TITLE);
    await teacher.getByRole('button', { name: /Tambahkan Kolom/i }).click();
    await teacher.waitForTimeout(2500);
    pass('Setup: kolom nilai dibuat', COLUMN_TITLE);

    // ---------- Nilai pertama disimpan sampai terkunci ----------
    const CELL = `input[aria-label="Nilai ${STUDENT_NAME} - ${COLUMN_TITLE}"]`;
    const scoreInput = teacher.locator(CELL).first();
    if (!(await scoreInput.count())) {
      await failWithEvidence(teacher, 'Nilai awal bisa diketik', 'sel input nilai tidak ditemukan');
      return;
    }
    await scoreInput.fill(FIRST_SCORE);
    await teacher.waitForTimeout(400);
    await teacher.getByRole('button', { name: /Review & Simpan/i }).click();
    await teacher.waitForTimeout(600);
    await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).click();
    await teacher.waitForTimeout(3000);

    // Sel terkunci = tidak ada lagi input yang bisa diketik untuk siswa ini,
    // nilainya tampil sebagai teks bergembok.
    const lockedCellVisible = await teacher.getByText(FIRST_SCORE, { exact: true }).count();
    const inputGone = (await teacher.locator(CELL).count()) === 0;
    if (lockedCellVisible > 0 && inputGone) {
      pass('Nilai tersimpan dan sel terkunci', FIRST_SCORE);
    } else {
      await failWithEvidence(
        teacher,
        'Nilai tersimpan dan sel terkunci',
        `nilai terlihat=${lockedCellVisible > 0}, input hilang=${inputGone}`
      );
    }

    // ---------- Pensil HARUS memunculkan konfirmasi, bukan langsung membuka ----------
    const pencil = teacher.locator(`button[aria-label*="Edit nilai ${STUDENT_NAME}"]`).first();
    if (!(await pencil.count())) {
      await failWithEvidence(teacher, 'Tombol pensil tersedia di sel terkunci', 'tombol pensil tidak ditemukan');
      return;
    }
    await pencil.click();
    await teacher.waitForTimeout(600);

    const dialogShown = await teacher.getByText('Ubah nilai?', { exact: true }).count();
    const stillLocked = (await teacher.locator(CELL).count()) === 0;
    if (dialogShown > 0 && stillLocked) {
      pass('Pensil memunculkan konfirmasi "Ubah nilai?" tanpa langsung membuka sel');
    } else {
      await failWithEvidence(
        teacher,
        'Pensil memunculkan konfirmasi "Ubah nilai?" tanpa langsung membuka sel',
        `dialog muncul=${dialogShown > 0}, sel masih terkunci=${stillLocked}`
      );
    }

    // ---------- Batal: nilai tetap terkunci ----------
    await teacher.getByRole('button', { name: /^Batal$/i }).first().click();
    await teacher.waitForTimeout(600);
    const lockedAfterCancel = (await teacher.locator(CELL).count()) === 0;
    const valueKept = await teacher.getByText(FIRST_SCORE, { exact: true }).count();
    if (lockedAfterCancel && valueKept > 0) {
      pass('Batal membiarkan nilai tetap terkunci', FIRST_SCORE);
    } else {
      await failWithEvidence(
        teacher,
        'Batal membiarkan nilai tetap terkunci',
        `sel masih terkunci=${lockedAfterCancel}, nilai bertahan=${valueKept > 0}`
      );
    }

    // ---------- Lanjutkan: sel terbuka untuk dikoreksi ----------
    await pencil.click();
    await teacher.waitForTimeout(600);
    await teacher.getByRole('button', { name: /^Lanjutkan$/i }).first().click();
    await teacher.waitForTimeout(600);
    const editable = teacher.locator(CELL).first();
    if (await editable.count()) {
      pass('Lanjutkan membuka sel untuk dikoreksi');
    } else {
      await failWithEvidence(teacher, 'Lanjutkan membuka sel untuk dikoreksi', 'sel tidak menjadi input');
      return;
    }

    // ---------- Koreksi tetap wajib lewat Review ----------
    await editable.fill(CORRECTED_SCORE);
    await teacher.waitForTimeout(400);
    await teacher.getByRole('button', { name: /Review & Simpan/i }).click();
    await teacher.waitForTimeout(600);
    const warnsAboutLocked = await teacher.getByText(/sudah terkunci/i).count();
    if (warnsAboutLocked > 0) {
      pass('Review mengingatkan bahwa yang diubah adalah nilai terkunci');
    } else {
      await failWithEvidence(
        teacher,
        'Review mengingatkan bahwa yang diubah adalah nilai terkunci',
        'peringatan nilai terkunci tidak muncul di modal Review'
      );
    }

    await teacher.getByRole('button', { name: /^Ubah Nilai$/i }).click();
    await teacher.waitForTimeout(3000);
    const correctedVisible = await teacher.getByText(CORRECTED_SCORE, { exact: true }).count();
    const relocked = (await teacher.locator(CELL).count()) === 0;
    if (correctedVisible > 0 && relocked) {
      pass('Nilai terkoreksi tersimpan dan terkunci kembali', CORRECTED_SCORE);
    } else {
      await failWithEvidence(
        teacher,
        'Nilai terkoreksi tersimpan dan terkunci kembali',
        `nilai baru terlihat=${correctedVisible > 0}, terkunci lagi=${relocked}`
      );
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
