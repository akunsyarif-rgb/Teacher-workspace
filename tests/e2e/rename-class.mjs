/**
 * Regression test: rename kelas (Pengaturan Kelas).
 *
 * Menutup bug "The string did not match the expected pattern." saat rename
 * ke nama berisi spasi+angka (mis. "XI A KESEHATAN 1") dan memastikan
 * prinsip classId/className tetap dipegang: className cuma atribut yang
 * bisa diedit bebas, identitas internal (accessCode/dokumen siswa) TIDAK
 * pernah berubah gara-gara rename, dan tidak ada data yang hilang/dibuat
 * ulang.
 *
 * Jalankan: npm run test:e2e:rename-class
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3100';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const STUDENT_NAME = 'Siswa Rename Uji';
const ORIGINAL_CLASS = 'X-1';
const CANCELLED_NAME = 'Percobaan Batal Rename';
const RENAMED_CLASS = 'XI A KESEHATAN 1'; // string persis dari laporan bug: spasi + angka
const JOURNAL_MATERIAL = 'Materi sebelum rename kelas';

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
    const file = `/tmp/e2e-rename-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
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

  const consoleErrors = [];
  teacher.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  teacher.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`));

  let accessCodeBeforeRename = null;

  try {
    // ---------- Setup: guru, kelas awal, siswa, jurnal, presensi ----------
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji Rename');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    pass('Setup: guru mendaftar');

    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('9001');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(ORIGINAL_CLASS);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(3000);
    if (await teacher.getByText(ORIGINAL_CLASS, { exact: true }).count()) {
      pass('Setup: kelas awal + siswa dibuat', ORIGINAL_CLASS);
    } else {
      fail('Setup: kelas awal + siswa dibuat', 'kartu kelas tidak muncul');
    }

    // Jurnal & presensi SEBELUM rename — buat data histori yang harus
    // tetap ada setelah nama kelas berubah.
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(ORIGINAL_CLASS)}&tab=jurnal`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(2000);
    await teacher.fill('input[placeholder*="Hukum Tajwid"]', JOURNAL_MATERIAL);
    await teacher.getByRole('button', { name: /Simpan Jurnal Mengajar/i }).click();
    await teacher.waitForTimeout(2500);
    pass('Setup: jurnal ditulis sebelum rename');

    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(ORIGINAL_CLASS)}&tab=presensi`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(2000);
    const startButton = teacher.getByRole('button', { name: /Mulai Presensi/i });
    if (await startButton.count()) {
      await startButton.click();
      await teacher.waitForTimeout(2000);
    }
    pass('Setup: presensi dimulai sebelum rename');

    // Buka detail kelas, catat accessCode siswa SEBELUM rename — jadi
    // acuan identitas internal yang harus tetap sama sesudahnya (skenario 9).
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByText(ORIGINAL_CLASS, { exact: true }).first().click();
    await teacher.waitForTimeout(1500);
    const codeButtonBefore = teacher.locator('button[title*="kode akses"]').first();
    if (await codeButtonBefore.count()) {
      accessCodeBeforeRename = (await codeButtonBefore.innerText()).trim().split('\n')[0].trim();
      pass('Setup: kode akses siswa dicatat sebelum rename', accessCodeBeforeRename);
    } else {
      fail('Setup: kode akses siswa dicatat sebelum rename', 'tombol kode akses tidak ditemukan');
    }

    // ---------- Skenario 4: Batal tidak mengubah data ----------
    await teacher.getByLabel('Pengaturan Kelas').click();
    await teacher.waitForTimeout(400);
    const renameInput = teacher.locator('input[placeholder="Contoh: XI F TEKNIK 2"]');
    await renameInput.fill(CANCELLED_NAME);
    await teacher.getByRole('button', { name: /^Batal$/i }).click();
    await teacher.waitForTimeout(500);
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(1500);
    const originalStillThere = await teacher.getByText(ORIGINAL_CLASS, { exact: true }).count();
    const cancelledLeaked = await teacher.getByText(CANCELLED_NAME, { exact: true }).count();
    if (originalStillThere > 0 && cancelledLeaked === 0) {
      pass('Skenario 4: Batal tidak mengubah nama kelas');
    } else {
      fail(
        'Skenario 4: Batal tidak mengubah nama kelas',
        `kelas asli terlihat=${originalStillThere > 0}, nama batal bocor=${cancelledLeaked > 0}`
      );
    }

    // ---------- Skenario 1+2+3: rename spasi+angka, berhasil ----------
    consoleErrors.length = 0; // reset supaya cuma tangkap error dari aksi rename sungguhan
    await teacher.getByText(ORIGINAL_CLASS, { exact: true }).first().click();
    await teacher.waitForTimeout(1000);
    await teacher.getByLabel('Pengaturan Kelas').click();
    await teacher.waitForTimeout(400);
    await teacher.locator('input[placeholder="Contoh: XI F TEKNIK 2"]').fill(RENAMED_CLASS);
    await teacher.getByRole('button', { name: /Simpan Nama Baru/i }).click();
    await teacher.waitForTimeout(2500);

    const errorBanner = await teacher.locator('text=/did not match|pattern|Gagal mengganti/i').count();
    const headerShowsNewName = await teacher.getByText(`Kelas ${RENAMED_CLASS}`, { exact: false }).count();
    if (errorBanner === 0 && headerShowsNewName > 0) {
      pass('Skenario 1+2+3: rename ke nama berisi spasi & angka berhasil', RENAMED_CLASS);
    } else {
      await failWithEvidence(
        teacher,
        'Skenario 1+2+3: rename ke nama berisi spasi & angka berhasil',
        `errorBanner=${errorBanner}, headerShowsNewName=${headerShowsNewName}`
      );
    }

    const jsErrorsDuringRename = consoleErrors.filter((e) => !/favicon|Failed to load resource/i.test(e));
    if (jsErrorsDuringRename.length === 0) {
      pass('Skenario 1+2+3: tidak ada JS error saat rename');
    } else {
      fail('Skenario 1+2+3: tidak ada JS error saat rename', jsErrorsDuringRename.join(' | '));
    }

    // ---------- Skenario 5: refresh setelah rename ----------
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(1500);
    const renamedVisibleAfterReload = await teacher.getByText(RENAMED_CLASS, { exact: true }).count();
    const oldNameGoneAfterReload = await teacher.getByText(ORIGINAL_CLASS, { exact: true }).count();
    if (renamedVisibleAfterReload > 0 && oldNameGoneAfterReload === 0) {
      pass('Skenario 5: nama baru bertahan setelah refresh/navigasi ulang');
    } else {
      fail(
        'Skenario 5: nama baru bertahan setelah refresh/navigasi ulang',
        `nama baru terlihat=${renamedVisibleAfterReload > 0}, nama lama masih ada=${oldNameGoneAfterReload > 0}`
      );
    }

    // ---------- Skenario 6: histori jurnal & presensi tetap tersedia ----------
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(RENAMED_CLASS)}&tab=jurnal`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(2500);
    const journalStillThere = await teacher.getByText(JOURNAL_MATERIAL).count();
    if (journalStillThere > 0) {
      pass('Skenario 6: histori jurnal tetap ada di bawah nama kelas baru');
    } else {
      await failWithEvidence(teacher, 'Skenario 6: histori jurnal tetap ada di bawah nama kelas baru', 'materi jurnal tidak ditemukan');
    }

    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(RENAMED_CLASS)}&tab=presensi`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(2000);
    const studentNameInPresensi = await teacher.getByText(STUDENT_NAME).count();
    if (studentNameInPresensi > 0) {
      pass('Skenario 6: histori presensi (grid siswa) tetap ada di bawah nama kelas baru');
    } else {
      await failWithEvidence(
        teacher,
        'Skenario 6: histori presensi (grid siswa) tetap ada di bawah nama kelas baru',
        'nama siswa tidak ditemukan di grid presensi'
      );
    }

    // ---------- Skenario 9: classId (identitas internal) tetap sama ----------
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByText(RENAMED_CLASS, { exact: true }).first().click();
    await teacher.waitForTimeout(1500);
    const codeButtonAfter = teacher.locator('button[title*="kode akses"]').first();
    let accessCodeAfterRename = null;
    if (await codeButtonAfter.count()) {
      accessCodeAfterRename = (await codeButtonAfter.innerText()).trim().split('\n')[0].trim();
    }
    if (accessCodeBeforeRename && accessCodeAfterRename && accessCodeBeforeRename === accessCodeAfterRename) {
      pass('Skenario 9: identitas internal siswa (kode akses) tidak berubah karena rename', accessCodeAfterRename);
    } else {
      fail(
        'Skenario 9: identitas internal siswa (kode akses) tidak berubah karena rename',
        `sebelum=${accessCodeBeforeRename}, sesudah=${accessCodeAfterRename}`
      );
    }

    // ---------- Skenario 7+8: student_profiles sinkron & Student Companion tetap bisa akses ----------
    if (accessCodeBeforeRename) {
      const student = await (await browser.newContext()).newPage();
      await student.goto(`${BASE_URL}/student/login`, { waitUntil: 'domcontentloaded' });
      await student.fill('input[placeholder*="CONTOH"]', accessCodeBeforeRename);
      await student.getByRole('button', { name: /Masuk/i }).click();
      try {
        await student.waitForURL(`${BASE_URL}/student`, { timeout: 25000 });
        await student.waitForTimeout(2500);
        if (student.url().includes('/student/login')) {
          await failWithEvidence(
            student,
            'Skenario 7+8: Student Companion tetap bisa login setelah rename',
            'sempat masuk lalu dilempar balik ke halaman login'
          );
        } else {
          pass('Skenario 7+8: Student Companion tetap bisa login setelah rename (student_profiles sinkron)');

          // /student/profil menampilkan "Kelas {className}" tanpa syarat
          // (tidak tergantung ada/tidaknya jadwal terisi), jadi lebih
          // andal untuk memastikan className yang tersinkron ke
          // student_profiles benar-benar nama BARU, bukan nama lama.
          await student.goto(`${BASE_URL}/student/profil`, { waitUntil: 'domcontentloaded' });
          await student.waitForTimeout(2000);
          const classNameShownToStudent = await student.getByText(`Kelas ${RENAMED_CLASS}`).count();
          if (classNameShownToStudent > 0) {
            pass('Skenario 7+8: siswa melihat nama kelas baru (bukan nama lama)');
          } else {
            await failWithEvidence(
              student,
              'Skenario 7+8: siswa melihat nama kelas baru (bukan nama lama)',
              'nama kelas baru tidak ditemukan di halaman profil siswa'
            );
          }
        }
      } catch (err) {
        await failWithEvidence(student, 'Skenario 7+8: Student Companion tetap bisa login setelah rename', err.message);
      }
      await student.close();
    } else {
      fail('Skenario 7+8: Student Companion tetap bisa login setelah rename', 'dilewati: kode akses sebelum rename tidak didapat');
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
