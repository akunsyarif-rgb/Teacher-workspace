/**
 * Regression test: alternatif lampiran lewat link Google Drive.
 *
 * Kenapa ada: Firebase Storage bisa gagal (misconfig bucket/billing/jaringan
 * sekolah) tanpa itu jadi alasan pengumpulan tugas berhenti total — siswa
 * yang punya jawaban teks atau link Google Drive tetap harus bisa
 * mengumpulkan. Fitur ini murni metadata (link disimpan apa adanya di
 * Firestore, TIDAK pernah diverifikasi aksesnya oleh server) dan tidak
 * boleh mengubah sedikit pun kontrak PR #41 (deadline, grade lock,
 * review-before-grade, teacher feedback).
 *
 * Jalankan: node tests/e2e/submission-drive-link.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3102';
const TEACHER_EMAIL = `guru-drive-${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const CLASS_NAME = 'XI-DRIVE';
const STUDENT_NAME = 'Sari Wulandari';

const TEXT_ONLY_ASSIGNMENT = 'Tugas Teks Saja';
const DRIVE_LINK_ASSIGNMENT = 'Tugas Link Drive';
const OVERDUE_ASSIGNMENT = 'Tugas Drive Lewat Tenggat';
const UPLOAD_FAIL_ASSIGNMENT = 'Tugas Upload Gagal';

const DRIVE_LINK = 'https://drive.google.com/file/d/abc123XYZ/view';
const TEACHER_FEEDBACK = 'Terima kasih, sudah rapi.';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

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
    const file = `/tmp/e2e-drive-link-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
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

async function buildApp() {
  if (process.env.E2E_SKIP_BUILD === 'true') {
    console.log('→ Melewati build (E2E_SKIP_BUILD=true), memakai build yang ada.');
    return;
  }
  console.log('→ Build aplikasi (mode emulator)...');
  await new Promise((resolve, reject) => {
    const build = spawn('npx', ['next', 'build'], {
      env: { ...process.env, ...APP_ENV },
      stdio: process.env.E2E_VERBOSE ? 'inherit' : ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    build.stderr?.on('data', (chunk) => (stderr += chunk));
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`next build gagal:\n${stderr.slice(-2000)}`))
    );
  });
}

function isPortTaken(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function startAppServer() {
  await buildApp();
  console.log('→ Menjalankan server...');
  if (await isPortTaken(3102)) {
    throw new Error('Port 3102 sudah dipakai proses lain — hentikan dulu supaya tidak menguji server yang salah.');
  }
  const server = spawn('npx', ['next', 'start', '--port', '3102', '--hostname', '127.0.0.1'], {
    env: { ...process.env, ...APP_ENV },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  server.stdout.on('data', (chunk) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(`[next] ${chunk}`);
  });
  server.stderr.on('data', (chunk) => {
    if (process.env.E2E_VERBOSE) process.stderr.write(`[next] ${chunk}`);
  });
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok || res.status === 404) return server;
    } catch {
      // belum siap
    }
    await sleep(1000);
  }
  throw new Error('Next.js tidak kunjung siap dalam 90 detik.');
}

function stopServer(server) {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    try {
      server.kill('SIGKILL');
    } catch {
      // memang sudah mati
    }
  }
}

async function openAssignmentsTab(teacher, className) {
  await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(className)}&tab=tugas`, {
    waitUntil: 'domcontentloaded',
  });
  await teacher.waitForTimeout(3000);
}

async function createAssignment(teacher, className, title, dueDate) {
  await openAssignmentsTab(teacher, className);
  await teacher.getByRole('button', { name: /Buat Tugas/i }).first().click();
  await teacher.waitForTimeout(800);
  await teacher.fill('input[placeholder*="Latihan Soal"]', title);
  await teacher.fill('input[type="date"]', dueDate);
  await teacher.getByRole('button', { name: /^Preview$/i }).click();
  await teacher.waitForTimeout(500);
  await teacher.getByRole('button', { name: /^Publish Tugas$/i }).click();
  await teacher.waitForTimeout(4000);
}

async function studentCard(student, title) {
  const cards = await student.locator('div.bg-white.p-4.rounded-2xl').all();
  for (const card of cards) {
    const text = await card.innerText();
    if (text.includes(title)) return card;
  }
  return null;
}

async function waitForText(scope, pattern, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      last = await scope.innerText();
      if (pattern.test(last)) return { found: true, text: last };
    } catch {
      // elemen bisa sedang dirender ulang
    }
    await sleep(500);
  }
  return { found: false, text: last };
}

async function openTeacherAssignment(teacher, className, title) {
  await openAssignmentsTab(teacher, className);
  const row = teacher.getByText(title, { exact: true }).first();
  if ((await row.count()) === 0) return false;
  await row.click();
  await teacher.waitForTimeout(3000);
  return true;
}

async function run() {
  const server = await startAppServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  const student = await studentContext.newPage();

  const consoleErrors = [];
  for (const [label, page] of [['guru', teacher], ['siswa', student]]) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`[${label}] ${err.message}`));
  }

  let accessCode = null;

  try {
    // ---------- Setup ----------
    console.log('\n→ Setup guru & siswa');
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji Drive');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });

    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('54321');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(4000);
    await teacher.getByText(CLASS_NAME, { exact: true }).first().click();
    await teacher.waitForTimeout(3000);
    const codeButton = teacher.locator('button[title="Salin kode akses Student Companion"]').first();
    if (await codeButton.count()) {
      accessCode = (await codeButton.innerText()).trim().split('\n')[0].trim();
      pass('Setup: guru, kelas, dan siswa siap', `kode ${accessCode}`);
    } else {
      fail('Setup: guru, kelas, dan siswa siap', 'kode akses siswa tidak ditemukan');
      throw new Error('setup gagal');
    }

    await createAssignment(teacher, CLASS_NAME, TEXT_ONLY_ASSIGNMENT, '2030-12-31');
    await createAssignment(teacher, CLASS_NAME, DRIVE_LINK_ASSIGNMENT, '2030-12-31');
    await createAssignment(teacher, CLASS_NAME, OVERDUE_ASSIGNMENT, '2020-01-01');
    await createAssignment(teacher, CLASS_NAME, UPLOAD_FAIL_ASSIGNMENT, '2030-12-31');
    pass('Setup: 4 tugas dipublish guru');

    await student.goto(`${BASE_URL}/student/login`, { waitUntil: 'domcontentloaded' });
    await student.fill('input[placeholder*="CONTOH"]', accessCode);
    await student.getByRole('button', { name: /Masuk/i }).click();
    await student.waitForURL(`${BASE_URL}/student`, { timeout: 25000 });
    await student.waitForTimeout(2500);
    await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3000);

    // ---------- 1. Siswa mengumpulkan teks saja (tanpa link/foto) ----------
    console.log('\n→ Siswa mengumpulkan teks saja');
    const textOnlyCard = await studentCard(student, TEXT_ONLY_ASSIGNMENT);
    if (textOnlyCard) {
      await textOnlyCard.getByRole('button', { name: /Kerjakan Tugas/i }).first().click();
      await student.waitForTimeout(500);
      await textOnlyCard.locator('textarea').fill('Jawaban teks tanpa lampiran apa pun.');
      await textOnlyCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();
      const confirmed = await waitForText(textOnlyCard, /Tugas berhasil dikumpulkan|Sudah dikumpulkan/i, 15000);
      if (confirmed.found) pass('Siswa mengumpulkan teks saja berhasil');
      else await failWithEvidence(student, 'Siswa mengumpulkan teks saja berhasil', confirmed.text.slice(0, 250));
    } else {
      fail('Siswa mengumpulkan teks saja berhasil', 'kartu tugas tidak ditemukan');
    }

    // ---------- 2. Siswa mengumpulkan teks + link Google Drive ----------
    console.log('\n→ Siswa mengumpulkan teks + link Google Drive');
    const driveCard = await studentCard(student, DRIVE_LINK_ASSIGNMENT);
    if (driveCard) {
      await driveCard.getByRole('button', { name: /Kerjakan Tugas/i }).first().click();
      await student.waitForTimeout(500);
      await driveCard.locator('textarea').fill('Jawaban saya, lampirannya di Drive.');
      await driveCard.getByRole('button', { name: /Atau kumpulkan lewat Google Drive/i }).click();
      await student.waitForTimeout(300);
      await driveCard.locator('input[type="url"]').fill(DRIVE_LINK);
      await student.waitForTimeout(300);
      const readyText = await driveCard.innerText();
      if (/Link Google Drive siap dikumpulkan/i.test(readyText)) {
        pass('Status "Link Google Drive siap dikumpulkan" tampil sebelum kirim');
      } else {
        fail('Status "Link Google Drive siap dikumpulkan" tampil sebelum kirim', readyText.slice(0, 250));
      }
      await driveCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();
      const confirmed = await waitForText(driveCard, /Tugas berhasil dikumpulkan|Sudah dikumpulkan/i, 15000);
      if (confirmed.found) pass('Siswa mengumpulkan teks + link Google Drive berhasil');
      else await failWithEvidence(student, 'Siswa mengumpulkan teks + link Google Drive berhasil', confirmed.text.slice(0, 250));
    } else {
      fail('Siswa mengumpulkan teks + link Google Drive berhasil', 'kartu tugas tidak ditemukan');
    }

    // ---------- 3+4. Guru melihat & bisa membuka link Google Drive ----------
    console.log('\n→ Guru mereview link Google Drive');
    if (await openTeacherAssignment(teacher, CLASS_NAME, DRIVE_LINK_ASSIGNMENT)) {
      await teacher.getByRole('button', { name: /^Review$/i }).first().click();
      await teacher.waitForTimeout(1200);
      const linkEl = teacher.getByRole('link', { name: /Lampiran Google Drive|Buka Google Drive/i }).first();
      if (await linkEl.count()) {
        pass('Link Google Drive tampil pada teacher review');
        const href = await linkEl.getAttribute('href');
        const target = await linkEl.getAttribute('target');
        const rel = await linkEl.getAttribute('rel');
        if (href === DRIVE_LINK && target === '_blank' && (rel || '').includes('noopener')) {
          pass('Guru dapat membuka link (href/target/rel benar, tanpa fetch server)');
        } else {
          fail('Guru dapat membuka link (href/target/rel benar, tanpa fetch server)', `href=${href} target=${target} rel=${rel}`);
        }
      } else {
        fail('Link Google Drive tampil pada teacher review', 'tautan tidak ditemukan di panel review');
      }

      // ---------- 5. Guru tetap bisa memberi feedback ----------
      await teacher.locator('textarea').first().fill(TEACHER_FEEDBACK);
      await teacher.getByRole('button', { name: /Simpan Catatan/i }).first().click();
      await teacher.waitForTimeout(3000);
      const afterFeedback = await teacher.locator('body').innerText();
      if (/Catatan tersimpan/i.test(afterFeedback) || afterFeedback.includes(TEACHER_FEEDBACK)) {
        pass('Guru tetap dapat memberi feedback pada submission berlink Drive');
      } else {
        fail('Guru tetap dapat memberi feedback pada submission berlink Drive', afterFeedback.slice(0, 200));
      }

      // ---------- 6. Guru tetap bisa memberi nilai setelah review ----------
      await teacher.fill('input[placeholder="Nilai"]', '88');
      await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).first().click();
      await teacher.waitForTimeout(600);
      await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).last().click();
      await teacher.waitForTimeout(4000);
      const graded = await teacher.locator('body').innerText();
      if (/Nilai 88/i.test(graded)) pass('Guru tetap dapat memberi nilai setelah review');
      else fail('Guru tetap dapat memberi nilai setelah review', graded.slice(0, 200));

      // ---------- 10. Submission yang sudah dinilai tetap terkunci ----------
      await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
      await student.waitForTimeout(3500);
      const gradedCard = await studentCard(student, DRIVE_LINK_ASSIGNMENT);
      const editableCount = gradedCard
        ? await gradedCard.getByRole('button', { name: /Kerjakan Tugas|Ubah Pengumpulan/i }).count()
        : -1;
      if (gradedCard && editableCount === 0) {
        pass('Submission yang sudah dinilai tetap terkunci (tombol kirim ulang hilang)');
      } else {
        fail('Submission yang sudah dinilai tetap terkunci (tombol kirim ulang hilang)', `tombol=${editableCount}`);
      }
    } else {
      fail('Guru membuka tugas berlink Drive untuk direview', 'tugas tidak ditemukan');
    }

    // ---------- 9. Deadline tetap berlaku untuk jalur link Drive ----------
    console.log('\n→ Deadline tetap berlaku');
    const overdueCard = await studentCard(student, OVERDUE_ASSIGNMENT);
    if (overdueCard) {
      const hasCta = await overdueCard.getByRole('button', { name: /Kerjakan Tugas|Ubah Pengumpulan/i }).count();
      const text = await overdueCard.innerText();
      if (hasCta === 0 && /melewati batas pengumpulan/i.test(text)) {
        pass('Tugas lewat tenggat tetap menolak pengumpulan (termasuk lewat link Drive)');
      } else {
        fail('Tugas lewat tenggat tetap menolak pengumpulan (termasuk lewat link Drive)', text.slice(0, 200));
      }
    } else {
      fail('Tugas lewat tenggat tetap menolak pengumpulan (termasuk lewat link Drive)', 'kartu tidak ditemukan');
    }

    // ---------- 11+12. Upload Firebase gagal ----------
    console.log('\n→ Upload Firebase gagal + alternatif link Drive');
    // Memutus permintaan ke Storage emulator secara sengaja — mensimulasikan
    // upload gagal (mis. bucket/billing salah konfigurasi di production)
    // tanpa bergantung pada kondisi jaringan asli yang tidak deterministik.
    await student.route('**/v0/b/**', (route) => route.abort('failed'));

    const uploadFailCard = await studentCard(student, UPLOAD_FAIL_ASSIGNMENT);
    if (uploadFailCard) {
      await uploadFailCard.getByRole('button', { name: /Kerjakan Tugas/i }).first().click();
      await student.waitForTimeout(500);
      await uploadFailCard.locator('input[type="file"]').first().setInputFiles([
        { name: 'foto-gagal.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG },
      ]);
      await student.waitForTimeout(500);
      await uploadFailCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();

      // lib/adapters/storageAdapter.ts menunggu 30 detik tanpa progres sama
      // sekali (stall timeout) sebelum menyerah — route.abort() di atas
      // tidak langsung menolak promise-nya karena Firebase SDK mencoba
      // ulang secara diam-diam dulu di baliknya, jadi menunggunya harus
      // lebih lama dari 30 detik itu sendiri.
      const failMsg = await waitForText(
        uploadFailCard,
        /Foto tidak dapat diunggah.*link Google Drive/i,
        40000
      );
      if (failMsg.found) pass('Upload gagal menampilkan pesan alternatif link Google Drive (bukan gagal total)');
      else await failWithEvidence(student, 'Upload gagal menampilkan pesan alternatif link Google Drive (bukan gagal total)', failMsg.text.slice(0, 250));

      const stillClosed = await studentCard(student, UPLOAD_FAIL_ASSIGNMENT);
      const stillHasCta = stillClosed
        ? await stillClosed.getByRole('button', { name: /^Kirim Tugas$/i }).count()
        : 0;
      if (stillHasCta > 0) pass('Form tetap terbuka setelah upload gagal — submission belum dianggap sukses');
      else fail('Form tetap terbuka setelah upload gagal — submission belum dianggap sukses', 'form ikut tertutup');

      // Buang foto yang gagal, ganti dengan link Drive, coba lagi.
      const removeFileBtn = uploadFailCard.getByRole('button', { name: /Hapus foto ini/i }).first();
      if (await removeFileBtn.count()) await removeFileBtn.click();
      await student.waitForTimeout(300);
      await uploadFailCard.locator('input[type="url"]').fill(DRIVE_LINK);
      await student.waitForTimeout(300);
      await uploadFailCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();
      const recovered = await waitForText(uploadFailCard, /Tugas berhasil dikumpulkan|Sudah dikumpulkan/i, 15000);
      if (recovered.found) pass('Upload gagal + link Google Drive → submission tetap berhasil');
      else await failWithEvidence(student, 'Upload gagal + link Google Drive → submission tetap berhasil', recovered.text.slice(0, 250));
    } else {
      fail('Upload gagal menampilkan pesan alternatif link Google Drive (bukan gagal total)', 'kartu tugas tidak ditemukan');
    }

    await student.unroute('**/v0/b/**');

    // ---------- 12b. Upload gagal TANPA jawaban/link → tetap ditolak ----------
    console.log('\n→ Upload gagal tanpa jawaban/link ditolak');
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=tugas`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(800);
    await teacher.getByRole('button', { name: /Buat Tugas/i }).first().click();
    await teacher.waitForTimeout(600);
    const emptyAssignment = 'Tugas Kosong Ditolak';
    await teacher.fill('input[placeholder*="Latihan Soal"]', emptyAssignment);
    await teacher.fill('input[type="date"]', '2030-12-31');
    await teacher.getByRole('button', { name: /^Preview$/i }).click();
    await teacher.waitForTimeout(500);
    await teacher.getByRole('button', { name: /^Publish Tugas$/i }).click();
    await teacher.waitForTimeout(3000);

    await student.route('**/v0/b/**', (route) => route.abort('failed'));
    await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3000);
    const emptyCard = await studentCard(student, emptyAssignment);
    if (emptyCard) {
      await emptyCard.getByRole('button', { name: /Kerjakan Tugas/i }).first().click();
      await student.waitForTimeout(400);
      await emptyCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();
      await student.waitForTimeout(600);
      const rejected = await emptyCard.innerText();
      if (/Isi jawaban, lampirkan foto, atau tempel link Google Drive dulu/i.test(rejected)) {
        pass('Submission kosong (tanpa jawaban/foto/link) tetap ditolak sesuai aturan existing');
      } else {
        fail('Submission kosong (tanpa jawaban/foto/link) tetap ditolak sesuai aturan existing', rejected.slice(0, 250));
      }
    } else {
      fail('Submission kosong (tanpa jawaban/foto/link) tetap ditolak sesuai aturan existing', 'kartu tugas tidak ditemukan');
    }
    await student.unroute('**/v0/b/**');
  } catch (error) {
    fail('Alur uji berhenti karena error tak terduga', error.message);
  } finally {
    await browser.close();
    stopServer(server);
  }

  console.log('\n' + '='.repeat(60));
  const failed = steps.filter((s) => !s.ok);
  console.log(`HASIL: ${steps.length - failed.length}/${steps.length} langkah berhasil`);
  console.log('='.repeat(60));
  if (consoleErrors.length > 0) {
    console.log('\nError konsol browser:');
    consoleErrors.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
  }
  if (failed.length > 0) process.exit(1);
}

run();
