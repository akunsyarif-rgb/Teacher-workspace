/**
 * Regression test: alur pengumpulan tugas siswa, ujung ke ujung.
 *
 * Kenapa ada: bug "siswa tidak bisa mengumpulkan tugas" lolos dari semua
 * test yang ada — termasuk tests/e2e/smoke.mjs — karena semuanya cuma
 * menjalankan jalur mulus (siswa mengumpulkan lebih dulu, guru menilai
 * belakangan, foto ber-MIME sempurna). Penyebab sebenarnya ada di jalur
 * yang tidak pernah dicoba:
 *
 *  1. Guru mengisi nilai untuk siswa yang BELUM mengumpulkan. Dokumen
 *     submission-nya terbuat dengan status 'dinilai', tombol Kumpulkan
 *     hilang dari layar siswa, dan rules ikut menolak tulisannya. Siswa
 *     terkunci permanen tanpa satu pun pesan.
 *  2. Foto dari HP yang dilaporkan sebagai application/octet-stream
 *     ditolak aplikasinya sendiri sebelum sempat diunggah.
 *  3. Tenggat tidak pernah ditegakkan.
 *
 * Jalankan: npm run test:e2e:submission
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3100';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const CLASS_NAME = 'XI-A';
const RENAMED_CLASS = 'XI A TEKNIK 2';
const STUDENT_NAME = 'Budi Santoso';

const OPEN_ASSIGNMENT = 'Tugas Terbuka';
const OVERDUE_ASSIGNMENT = 'Tugas Lewat Tenggat';
const PREGRADED_ASSIGNMENT = 'Tugas Dinilai Duluan';
const OFFLINE_ASSIGNMENT = 'Tugas Uji Offline';

const STUDENT_ANSWER = 'Ini jawaban saya untuk tugas terbuka.';
const TEACHER_FEEDBACK = 'Rapikan langkah nomor 3 ya.';

// PNG 1x1 asli: Storage rules menyaring berdasarkan contentType, dan
// isinya harus benar-benar gambar.
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
    const file = `/tmp/e2e-submission-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
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
  if (await isPortTaken(3100)) {
    throw new Error('Port 3100 sudah dipakai proses lain — hentikan dulu supaya tidak menguji server yang salah.');
  }
  const server = spawn('npx', ['next', 'start', '--port', '3100', '--hostname', '127.0.0.1'], {
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

/** Kartu tugas siswa dicari lewat judulnya, bukan lewat urutan. */
async function studentCard(student, title) {
  const cards = await student.locator('div.bg-white.p-4.rounded-2xl').all();
  for (const card of cards) {
    const text = await card.innerText();
    if (text.includes(title)) return card;
  }
  return null;
}

/**
 * Menunggu sebuah teks muncul, bukan menebak berapa lama sesuatu selesai.
 * Unggah lampiran + tulis Firestore lamanya berbeda-beda di tiap mesin,
 * dan `waitForTimeout` tetap yang bikin uji ini rapuh, bukan aplikasinya.
 */
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

  // Pesan mentah SDK tidak boleh pernah muncul di layar siswa; error
  // konsol dikumpulkan supaya kegagalan diam-diam tetap terlihat.
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
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });

    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('12345');
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

    await createAssignment(teacher, CLASS_NAME, OPEN_ASSIGNMENT, '2030-12-31');
    await createAssignment(teacher, CLASS_NAME, OVERDUE_ASSIGNMENT, '2020-01-01');
    await createAssignment(teacher, CLASS_NAME, PREGRADED_ASSIGNMENT, '2030-12-31');
    await createAssignment(teacher, CLASS_NAME, OFFLINE_ASSIGNMENT, '2030-12-31');
    pass('Setup: 4 tugas dipublish guru');

    await student.goto(`${BASE_URL}/student/login`, { waitUntil: 'domcontentloaded' });
    await student.fill('input[placeholder*="CONTOH"]', accessCode);
    await student.getByRole('button', { name: /Masuk/i }).click();
    await student.waitForURL(`${BASE_URL}/student`, { timeout: 25000 });
    await student.waitForTimeout(2500);

    // ---------- 1. Siswa membuka tugas ----------
    console.log('\n→ Siswa mengumpulkan');
    await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3000);
    if ((await studentCard(student, OPEN_ASSIGNMENT)) !== null) pass('Siswa bisa membuka daftar & detail tugas');
    else await failWithEvidence(student, 'Siswa bisa membuka daftar & detail tugas', 'tugas tidak muncul');

    // ---------- 2. Tenggat dihormati ----------
    const overdueCard = await studentCard(student, OVERDUE_ASSIGNMENT);
    if (overdueCard) {
      const text = await overdueCard.innerText();
      const hasSubmitCta = await overdueCard.getByRole('button', { name: /Kerjakan Tugas|Ubah Pengumpulan/i }).count();
      if (hasSubmitCta === 0 && /melewati batas pengumpulan/i.test(text)) {
        pass('Tugas lewat tenggat: tombol kirim hilang DAN alasannya dijelaskan');
      } else {
        fail(
          'Tugas lewat tenggat: tombol kirim hilang DAN alasannya dijelaskan',
          `tombol=${hasSubmitCta}, teks="${text.replace(/\n+/g, ' | ').slice(0, 200)}"`
        );
      }
    } else {
      fail('Tugas lewat tenggat: tombol kirim hilang DAN alasannya dijelaskan', 'kartu tidak ditemukan');
    }

    // ---------- 3. Jawaban teks + lampiran ber-MIME "salah" ----------
    // application/octet-stream adalah yang dilaporkan aplikasi berkas
    // Android/Google Drive untuk foto .jpg — persis kasus yang dulu
    // ditolak aplikasinya sendiri.
    const openCard = await studentCard(student, OPEN_ASSIGNMENT);
    if (openCard) {
      await openCard.getByRole('button', { name: /Kerjakan Tugas/i }).first().click();
      await student.waitForTimeout(600);
      await openCard.locator('textarea').fill(STUDENT_ANSWER);
      await openCard.locator('input[type="file"]').first().setInputFiles([
        { name: 'foto-jawaban.jpg', mimeType: 'application/octet-stream', buffer: ONE_PIXEL_PNG },
      ]);
      await student.waitForTimeout(800);
      const afterPick = await openCard.innerText();
      if (/Format file harus/i.test(afterPick)) {
        fail('Foto dari HP (MIME application/octet-stream) bisa dilampirkan', 'ditolak validasi klien');
      } else {
        pass('Foto dari HP (MIME application/octet-stream) bisa dilampirkan');
      }

      await openCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();

      // Bannernya sengaja hilang sendiri setelah beberapa detik, jadi
      // ditunggu kemunculannya — bukan dibaca sekali setelah jeda tetap.
      const confirmed = await waitForText(openCard, /Tugas berhasil dikumpulkan/i, 30000);
      if (confirmed.found) pass('Siswa mendapat konfirmasi "Tugas berhasil dikumpulkan"');
      else fail('Siswa mendapat konfirmasi "Tugas berhasil dikumpulkan"', confirmed.text.replace(/\n+/g, ' | ').slice(0, 250));

      const afterSubmit = (await (await studentCard(student, OPEN_ASSIGNMENT))?.innerText()) || '';
      if (/Sudah dikumpulkan/i.test(afterSubmit)) pass('Status siswa berubah jadi "Sudah dikumpulkan"');
      else fail('Status siswa berubah jadi "Sudah dikumpulkan"', afterSubmit.replace(/\n+/g, ' | ').slice(0, 250));

      if (/foto-jawaban\.jpg/i.test(afterSubmit)) pass('Lampiran tersimpan dan terlihat siswa');
      else fail('Lampiran tersimpan dan terlihat siswa', 'nama lampiran tidak muncul setelah dikumpulkan');
    } else {
      fail('Siswa mengumpulkan jawaban + lampiran', 'kartu tugas terbuka tidak ditemukan');
    }

    // ---------- 4. Submission benar-benar tersimpan (bertahan reload) ----------
    await student.reload({ waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3500);
    const reloaded = (await (await studentCard(student, OPEN_ASSIGNMENT))?.innerText()) || '';
    if (reloaded.includes(STUDENT_ANSWER) && /Sudah dikumpulkan/i.test(reloaded)) {
      pass('Submission tersimpan (bertahan setelah halaman dimuat ulang)');
    } else {
      fail('Submission tersimpan (bertahan setelah halaman dimuat ulang)', reloaded.replace(/\n+/g, ' | ').slice(0, 200));
    }

    // ---------- 5. Guru mereview SEBELUM menilai ----------
    console.log('\n→ Guru mereview & menilai');
    if (await openTeacherAssignment(teacher, CLASS_NAME, OPEN_ASSIGNMENT)) {
      const panelText = await teacher.locator('body').innerText();
      if (/1 dari 1 siswa sudah mengumpulkan/i.test(panelText)) {
        pass('Guru melihat siapa sudah/belum mengumpulkan');
      } else {
        fail('Guru melihat siapa sudah/belum mengumpulkan', panelText.replace(/\n+/g, ' | ').slice(0, 200));
      }

      // Menilai tidak boleh mungkin sebelum submission dibuka.
      const gradeBeforeReview = await teacher.getByRole('button', { name: /Simpan Nilai|Ubah Nilai/i }).count();
      if (gradeBeforeReview === 0) pass('Guru tidak bisa menilai sebelum membuka submission');
      else fail('Guru tidak bisa menilai sebelum membuka submission', `${gradeBeforeReview} tombol nilai tampil di daftar`);

      await teacher.getByRole('button', { name: /^Review$/i }).first().click();
      await teacher.waitForTimeout(1500);
      const reviewText = await teacher.locator('body').innerText();
      if (reviewText.includes(STUDENT_ANSWER)) pass('Guru melihat isi jawaban siswa saat review');
      else fail('Guru melihat isi jawaban siswa saat review', reviewText.replace(/\n+/g, ' | ').slice(0, 200));

      const attachmentLink = teacher.getByRole('link', { name: /foto-jawaban\.jpg/i }).first();
      if (await attachmentLink.count()) {
        const href = await attachmentLink.getAttribute('href');
        try {
          const res = await fetch(href);
          if (res.ok) pass('Guru bisa membuka lampiran siswa', `HTTP ${res.status}`);
          else fail('Guru bisa membuka lampiran siswa', `unduhan gagal HTTP ${res.status}`);
        } catch (err) {
          fail('Guru bisa membuka lampiran siswa', `unduhan error ${err.message}`);
        }
      } else {
        fail('Guru bisa membuka lampiran siswa', 'tautan lampiran tidak muncul di panel review');
      }

      // ---------- 6. Catatan TANPA nilai ----------
      await teacher.locator('textarea').first().fill(TEACHER_FEEDBACK);
      await teacher.getByRole('button', { name: /Simpan Catatan/i }).first().click();
      await teacher.waitForTimeout(3500);
      const afterFeedback = await teacher.locator('body').innerText();
      if (/Catatan tersimpan/i.test(afterFeedback) || afterFeedback.includes(TEACHER_FEEDBACK)) {
        pass('Guru bisa memberi catatan tanpa memberi nilai');
      } else {
        fail('Guru bisa memberi catatan tanpa memberi nilai', afterFeedback.replace(/\n+/g, ' | ').slice(0, 200));
      }
      if (!/• Nilai /i.test(afterFeedback)) pass('Catatan tanpa nilai tidak diam-diam ikut menilai siswa');
      else fail('Catatan tanpa nilai tidak diam-diam ikut menilai siswa', 'nilai muncul padahal belum diisi');
    } else {
      fail('Guru membuka tugas untuk direview', 'tugas tidak ditemukan di daftar');
    }

    // ---------- 7. Siswa melihat catatan guru ----------
    await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3500);
    const withFeedback = (await (await studentCard(student, OPEN_ASSIGNMENT))?.innerText()) || '';
    if (withFeedback.includes(TEACHER_FEEDBACK)) pass('Siswa melihat catatan guru');
    else fail('Siswa melihat catatan guru', withFeedback.replace(/\n+/g, ' | ').slice(0, 200));

    // ---------- 8. Nilai setelah review, lewat konfirmasi ----------
    if (await openTeacherAssignment(teacher, CLASS_NAME, OPEN_ASSIGNMENT)) {
      await teacher.getByRole('button', { name: /^Review$/i }).first().click();
      await teacher.waitForTimeout(1200);
      await teacher.fill('input[placeholder="Nilai"]', '90');
      await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).first().click();
      await teacher.waitForTimeout(800);
      const confirmVisible = await teacher.getByText(/Nilai akan disimpan dan terkunci/i).count();
      if (confirmVisible > 0) pass('Nilai butuh konfirmasi eksplisit sebelum tersimpan');
      else fail('Nilai butuh konfirmasi eksplisit sebelum tersimpan', 'dialog konfirmasi tidak muncul');

      await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).last().click();
      await teacher.waitForTimeout(4000);
      const graded = await teacher.locator('body').innerText();
      if (/Nilai 90/i.test(graded)) pass('Guru memberi nilai setelah review');
      else fail('Guru memberi nilai setelah review', graded.replace(/\n+/g, ' | ').slice(0, 200));

      // ---------- 9. Grade lock: "Ubah nilai?" ----------
      await teacher.getByRole('button', { name: /^Review$/i }).first().click();
      await teacher.waitForTimeout(1200);
      const lockedInputs = await teacher.locator('input[placeholder="Nilai"]').count();
      if (lockedInputs === 0) pass('Nilai tersimpan terkunci — tidak bisa langsung diketik ulang');
      else fail('Nilai tersimpan terkunci — tidak bisa langsung diketik ulang', 'kolom nilai masih bisa diketik');

      await teacher.locator('button:has-text("90")').first().click();
      await teacher.waitForTimeout(800);
      const unlockDialog = await teacher.getByText(/Nilai ini sudah terkunci/i).count();
      if (unlockDialog > 0) pass('Pensil nilai terkunci tetap lewat dialog "Ubah nilai?"');
      else fail('Pensil nilai terkunci tetap lewat dialog "Ubah nilai?"', 'dialog tidak muncul');

      await teacher.getByRole('button', { name: /^Lanjutkan$/i }).click();
      await teacher.waitForTimeout(800);
      await teacher.fill('input[placeholder="Nilai"]', '95');
      await teacher.getByRole('button', { name: /^Ubah Nilai$/i }).first().click();
      await teacher.waitForTimeout(800);
      await teacher.getByRole('button', { name: /^Ubah Nilai$/i }).last().click();
      await teacher.waitForTimeout(4000);
      const regraded = await teacher.locator('body').innerText();
      if (/Nilai 95/i.test(regraded)) pass('Nilai bisa dikoreksi lewat alur terkunci yang benar');
      else fail('Nilai bisa dikoreksi lewat alur terkunci yang benar', regraded.replace(/\n+/g, ' | ').slice(0, 200));

      if (regraded.includes(TEACHER_FEEDBACK)) pass('Catatan guru tidak hilang saat nilai diubah');
      else fail('Catatan guru tidak hilang saat nilai diubah', 'catatan hilang setelah nilai diubah');
    }

    // ---------- 10. Siswa melihat nilai & status akhir ----------
    await student.goto(`${BASE_URL}/student/nilai`, { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3500);
    if ((await student.getByText('95').count()) > 0) pass('Nilai sampai ke halaman Nilai siswa');
    else fail('Nilai sampai ke halaman Nilai siswa', 'angka 95 tidak ditemukan');

    await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3500);
    const finalCard = (await (await studentCard(student, OPEN_ASSIGNMENT))?.innerText()) || '';
    if (/Sudah dinilai/i.test(finalCard) && finalCard.includes(TEACHER_FEEDBACK)) {
      pass('Siswa melihat status "Sudah dinilai" beserta catatan guru');
    } else {
      fail('Siswa melihat status "Sudah dinilai" beserta catatan guru', finalCard.replace(/\n+/g, ' | ').slice(0, 200));
    }

    // ---------- 11. REGRESI UTAMA ----------
    // Guru menilai siswa yang BELUM mengumpulkan. Sebelum perbaikan, sejak
    // titik ini siswa terkunci permanen dari tombol Kumpulkan.
    console.log('\n→ Regresi: guru menilai sebelum siswa mengumpulkan');
    if (await openTeacherAssignment(teacher, CLASS_NAME, PREGRADED_ASSIGNMENT)) {
      await teacher.getByRole('button', { name: /^Review$/i }).first().click();
      await teacher.waitForTimeout(1200);
      await teacher.fill('input[placeholder="Nilai"]', '70');
      await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).first().click();
      await teacher.waitForTimeout(800);
      await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).last().click();
      await teacher.waitForTimeout(4000);
      const pregraded = await teacher.locator('body').innerText();
      if (/Nilai 70/i.test(pregraded)) pass('Guru tetap bisa menilai pekerjaan luring (nilai tersimpan)');
      else fail('Guru tetap bisa menilai pekerjaan luring (nilai tersimpan)', pregraded.replace(/\n+/g, ' | ').slice(0, 200));

      if (/Belum mengumpulkan/i.test(pregraded)) {
        pass('Status siswa tetap "Belum mengumpulkan" walau sudah dinilai');
      } else {
        fail('Status siswa tetap "Belum mengumpulkan" walau sudah dinilai', pregraded.replace(/\n+/g, ' | ').slice(0, 200));
      }
    }

    await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
    await student.waitForTimeout(3500);
    const pregradedCard = await studentCard(student, PREGRADED_ASSIGNMENT);
    if (pregradedCard && (await pregradedCard.getByRole('button', { name: /Kerjakan Tugas/i }).count()) > 0) {
      pass('REGRESI: siswa MASIH bisa mengumpulkan walau gurunya sudah mengisi nilai');
      await pregradedCard.getByRole('button', { name: /Kerjakan Tugas/i }).first().click();
      await student.waitForTimeout(600);
      await pregradedCard.locator('textarea').fill('Jawaban menyusul setelah dinilai luring.');
      await pregradedCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();
      await student.waitForTimeout(6000);
      const submitted = (await (await studentCard(student, PREGRADED_ASSIGNMENT))?.innerText()) || '';
      if (/Sudah dikumpulkan|Tugas berhasil dikumpulkan/i.test(submitted)) {
        pass('REGRESI: pengumpulannya benar-benar tersimpan, bukan cuma tombolnya muncul');
      } else {
        fail('REGRESI: pengumpulannya benar-benar tersimpan, bukan cuma tombolnya muncul', submitted.replace(/\n+/g, ' | ').slice(0, 250));
      }
    } else {
      await failWithEvidence(
        student,
        'REGRESI: siswa MASIH bisa mengumpulkan walau gurunya sudah mengisi nilai',
        'tombol kirim tidak ada — siswa terkunci seperti bug aslinya'
      );
    }

    // ---------- 12. Kegagalan jaringan ditangani manusiawi ----------
    console.log('\n→ Penanganan error');
    await studentContext.setOffline(true);
    const offlineCard = await studentCard(student, OFFLINE_ASSIGNMENT);
    if (offlineCard) {
      await offlineCard.getByRole('button', { name: /Kerjakan Tugas/i }).first().click();
      await student.waitForTimeout(500);
      await offlineCard.locator('textarea').fill('jawaban saat offline');
      await offlineCard.getByRole('button', { name: /^Kirim Tugas$/i }).click();
      await student.waitForTimeout(2500);
      const offlineText = await offlineCard.innerText();
      const humane = /offline|koneksi internet/i.test(offlineText);
      const raw = /FirebaseError|DOMException|SyntaxError|undefined|\[code=/i.test(offlineText);
      if (humane && !raw) pass('Gagal kirim saat offline dijelaskan dengan bahasa manusia');
      else fail('Gagal kirim saat offline dijelaskan dengan bahasa manusia', offlineText.replace(/\n+/g, ' | ').slice(0, 250));
    } else {
      fail('Gagal kirim saat offline dijelaskan dengan bahasa manusia', 'kartu tugas uji offline tidak ditemukan');
    }
    await studentContext.setOffline(false);

    // ---------- 13. Rename kelas tidak memutus submission ----------
    console.log('\n→ Rename kelas');
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(2500);
    await teacher.getByText(CLASS_NAME, { exact: true }).first().click();
    await teacher.waitForTimeout(2500);
    await teacher.getByLabel('Pengaturan Kelas').click();
    await teacher.waitForTimeout(600);
    const renameInput = teacher.locator('input[placeholder="Contoh: XI F TEKNIK 2"]');
    if (await renameInput.count()) {
      await renameInput.fill(RENAMED_CLASS);
      await teacher.getByRole('button', { name: /Simpan Nama Baru/i }).click();
      await teacher.waitForTimeout(9000);

      if (await openTeacherAssignment(teacher, RENAMED_CLASS, OPEN_ASSIGNMENT)) {
        const listed = await waitForText(teacher.locator('body'), /siswa sudah mengumpulkan/i, 20000);
        if (!listed.found) {
          fail(
            'Rename kelas tidak memutus relasi submission (jawaban & catatan tetap terbaca)',
            `daftar submission tidak termuat setelah rename: ${listed.text.replace(/\n+/g, ' | ').slice(0, 400)}`
          );
        } else {
          await teacher.getByRole('button', { name: /^Review$/i }).first().click();
          const reviewed = await waitForText(teacher.locator('body'), new RegExp(STUDENT_ANSWER.slice(0, 20)), 20000);
          const afterRename = reviewed.text;
          // Catatan guru berada di dalam <textarea> selagi panel review
          // terbuka, jadi nilainya dibaca dari field-nya — innerText halaman
          // tidak memuat isi textarea.
          const feedbackValue = await teacher.locator('textarea').first().inputValue();
          if (afterRename.includes(STUDENT_ANSWER) && feedbackValue.includes(TEACHER_FEEDBACK)) {
            pass('Rename kelas tidak memutus relasi submission (jawaban & catatan tetap terbaca)');
          } else {
            fail(
              'Rename kelas tidak memutus relasi submission (jawaban & catatan tetap terbaca)',
              `${afterRename.replace(/\n+/g, ' | ').slice(0, 400)} | catatan di form: "${feedbackValue}"`
            );
          }
        }
      } else {
        fail('Rename kelas tidak memutus relasi submission (jawaban & catatan tetap terbaca)', 'tugas tidak ditemukan setelah rename');
      }

      await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
      await student.waitForTimeout(4000);
      const afterRenameStudent = (await (await studentCard(student, OPEN_ASSIGNMENT))?.innerText()) || '';
      if (afterRenameStudent.includes(STUDENT_ANSWER)) {
        pass('Siswa tetap melihat pengumpulannya setelah kelas diganti nama');
      } else {
        fail('Siswa tetap melihat pengumpulannya setelah kelas diganti nama', afterRenameStudent.replace(/\n+/g, ' | ').slice(0, 250));
      }
    } else {
      fail('Rename kelas tidak memutus relasi submission (jawaban & catatan tetap terbaca)', 'form rename tidak ditemukan');
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
  console.log('='.repeat(60));
  if (consoleErrors.length > 0) {
    console.log('\nError konsol browser:');
    consoleErrors.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
  }
  if (failed.length > 0) process.exit(1);
}

run();
