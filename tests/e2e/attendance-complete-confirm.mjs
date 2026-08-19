/**
 * Regression test: konfirmasi "Tandai Presensi Selesai" + tetap di tab
 * Presensi setelahnya.
 *
 * Sebelumnya menekan "Tandai Presensi Selesai" langsung mengeksekusi tanpa
 * konfirmasi, DAN otomatis melempar guru ke tab Jurnal — membingungkan
 * karena terasa seperti aplikasi mengambil alih navigasi. Sekarang harus:
 * (1) muncul dialog konfirmasi Batal/Ya sebelum benar-benar menandai,
 * (2) Batal TIDAK mengubah status apa pun,
 * (3) Ya menandai selesai + menampilkan feedback + TETAP di tab Presensi.
 *
 * Jalankan: npm run test:e2e:attendance-complete-confirm
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3101';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const STUDENT_NAME = 'Siswa Uji Presensi';
const CLASS_NAME = 'X-PRESENSI-1';

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
    const file = `/tmp/e2e-presensi-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
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
  if (await isPortTaken(3101)) throw new Error('Port 3101 sudah dipakai proses lain.');
  await buildApp();
  console.log('→ Menjalankan server produksi di :3101...');
  const server = spawn('npx', ['next', 'start', '--port', '3101', '--hostname', '127.0.0.1'], {
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

  const consoleErrors = [];
  teacher.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  teacher.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`));

  try {
    // ---------- Setup: guru, kelas, siswa ----------
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji Presensi');
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

    // ---------- Mulai presensi ----------
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=presensi`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(2000);
    const startButton = teacher.getByRole('button', { name: /Mulai Presensi/i });
    if (await startButton.count()) {
      await startButton.click();
      await teacher.waitForTimeout(2000);
    }
    const markButtonExistsAfterStart = await teacher.getByRole('button', { name: /Tandai Presensi Selesai/i }).count();
    if (markButtonExistsAfterStart > 0) {
      pass('Setup: sesi presensi dimulai, tombol "Tandai Presensi Selesai" muncul');
    } else {
      await failWithEvidence(teacher, 'Setup: sesi presensi dimulai', 'tombol "Tandai Presensi Selesai" tidak ditemukan');
    }

    // ---------- Skenario 1: klik "Tandai Presensi Selesai" memunculkan konfirmasi, BUKAN langsung eksekusi ----------
    await teacher.getByRole('button', { name: /Tandai Presensi Selesai/i }).click();
    await teacher.waitForTimeout(500);
    const confirmDialogVisible = await teacher.getByText('Tandai Presensi Selesai?', { exact: true }).count();
    // Pola dengan tanda pisah "—" ini KHAS banner hijau setelah benar-benar
    // selesai (lihat AttendanceTab) — bukan cocok longgar "Presensi
    // Selesai" yang juga muncul sebagai substring di label tombolnya
    // sendiri ("Tandai Presensi Selesai"), yang tetap terlihat di belakang
    // overlay modal.
    const completedBannerTooEarly = await teacher.getByText(/Presensi selesai —/i).count();
    if (confirmDialogVisible > 0 && completedBannerTooEarly === 0) {
      pass('Skenario 1: dialog konfirmasi muncul sebelum benar-benar menandai selesai');
    } else {
      await failWithEvidence(
        teacher,
        'Skenario 1: dialog konfirmasi muncul sebelum benar-benar menandai selesai',
        `dialog terlihat=${confirmDialogVisible > 0}, banner selesai muncul lebih awal=${completedBannerTooEarly > 0}`
      );
    }

    // ---------- Skenario 2: "Batal" tidak mengubah status ----------
    await teacher.getByRole('button', { name: /^Batal$/i }).click();
    await teacher.waitForTimeout(500);
    const dialogGoneAfterCancel = await teacher.getByText('Tandai Presensi Selesai?', { exact: true }).count();
    const stillNotCompletedAfterCancel = await teacher.getByRole('button', { name: /Tandai Presensi Selesai/i }).count();
    const completedBannerAfterCancel = await teacher.getByText(/Presensi selesai —/i).count();
    if (dialogGoneAfterCancel === 0 && stillNotCompletedAfterCancel > 0 && completedBannerAfterCancel === 0) {
      pass('Skenario 2: Batal menutup dialog TANPA menandai presensi selesai');
    } else {
      await failWithEvidence(
        teacher,
        'Skenario 2: Batal menutup dialog TANPA menandai presensi selesai',
        `dialog masih ada=${dialogGoneAfterCancel > 0}, tombol tandai masih ada=${stillNotCompletedAfterCancel > 0}, banner selesai muncul=${completedBannerAfterCancel > 0}`
      );
    }

    // ---------- Skenario 3: konfirmasi "Ya, Tandai Selesai" -> selesai + feedback + TETAP di tab Presensi ----------
    consoleErrors.length = 0;
    await teacher.getByRole('button', { name: /Tandai Presensi Selesai/i }).click();
    await teacher.waitForTimeout(400);
    await teacher.getByRole('button', { name: /Ya, Tandai Selesai/i }).click();
    await teacher.waitForTimeout(1500);

    const completedFeedbackVisible = await teacher.getByText(/Presensi selesai —/i).count();
    if (completedFeedbackVisible > 0) {
      pass('Skenario 3: feedback "Presensi selesai" tampil setelah konfirmasi');
    } else {
      await failWithEvidence(teacher, 'Skenario 3: feedback "Presensi selesai" tampil setelah konfirmasi', 'banner feedback tidak ditemukan');
    }

    // Masih di tab Presensi: "Daftar Absen" (isi khas AttendanceTab) harus
    // tetap terlihat, dan field khas JournalTab TIDAK boleh muncul —
    // sebelumnya bug-nya justru melempar ke tab Jurnal otomatis di sini.
    const stillOnPresensiTab = await teacher.getByText(/Daftar Absen/i).count();
    const jumpedToJurnalTab = await teacher.getByRole('button', { name: /Simpan Jurnal Mengajar/i }).count();
    if (stillOnPresensiTab > 0 && jumpedToJurnalTab === 0) {
      pass('Skenario 3: tetap di tab Presensi, TIDAK otomatis pindah ke tab Jurnal');
    } else {
      await failWithEvidence(
        teacher,
        'Skenario 3: tetap di tab Presensi, TIDAK otomatis pindah ke tab Jurnal',
        `masih di presensi=${stillOnPresensiTab > 0}, ikut lompat ke jurnal=${jumpedToJurnalTab > 0}`
      );
    }

    // Guru tetap BEBAS pindah sendiri ke Jurnal kapan pun mau.
    await teacher.getByRole('button', { name: 'Jurnal Mengajar' }).click();
    await teacher.waitForTimeout(1000);
    const canStillOpenJurnalManually = await teacher.getByRole('button', { name: /Simpan Jurnal Mengajar/i }).count();
    if (canStillOpenJurnalManually > 0) {
      pass('Skenario 3: guru tetap bisa pindah ke Jurnal secara manual kapan pun mau');
    } else {
      await failWithEvidence(teacher, 'Skenario 3: guru tetap bisa pindah ke Jurnal secara manual', 'tab Jurnal tidak terbuka saat diklik manual');
    }

    const jsErrors = consoleErrors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    if (jsErrors.length === 0) {
      pass('Tidak ada JS error selama alur konfirmasi presensi selesai');
    } else {
      fail('Tidak ada JS error selama alur konfirmasi presensi selesai', jsErrors.join(' | '));
    }
  } catch (error) {
    fail('Alur uji berhenti karena error tak terduga', error.message);
  } finally {
    await browser.close();
    stopServer(server);
  }

  console.log('\n' + '='.repeat(60));
  const failed = steps.filter((s) => !s.ok);
  console.log(`HASIL: ${steps.length - failed.length}/${steps.length} langkah berhasil`);
  if (failed.length > 0) {
    console.log('\nGagal:');
    failed.forEach((s) => console.log(`  - ${s.name}: ${s.detail}`));
  }
  console.log('='.repeat(60));

  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('Uji gagal dijalankan:', error);
  process.exit(1);
});
