/**
 * Uji alur nyata Teacher Workspace <-> Student Companion di browser
 * sungguhan, dijalankan di atas Firebase Emulator.
 *
 * Kenapa ada: build hijau dan test rules hijau TIDAK membuktikan
 * aplikasinya jalan. Bug "klaim kode akses" pernah lolos keduanya karena
 * tidak ada satu pun test yang benar-benar menjalankan alurnya sebagai
 * pengguna. Ini menutup celah itu.
 *
 * Jalankan: npm run test:e2e
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3100';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const CLASS_NAME = 'XI-A';
const STUDENT_NAME = 'Budi Santoso';
const ASSIGNMENT_TITLE = 'Latihan Soal Bab 3';

// PNG 1x1 asli (bukan byte acak): Storage rules menyaring berdasarkan
// contentType, dan browser menentukannya dari isi berkas.
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

/**
 * Saat sebuah langkah gagal, "tidak ditemukan" saja tidak cukup untuk tahu
 * apakah yang salah aplikasinya atau selektor di uji ini. Tangkapan layar
 * dan cuplikan teks halaman membuat bedanya langsung terlihat.
 */
async function failWithEvidence(page, name, detail) {
  let evidence = detail;
  try {
    const file = `/tmp/e2e-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
    evidence = `${detail} | layar: ${file} | teks halaman: "${text}"`;
  } catch {
    // halaman mungkin sudah tertutup — pakai detail apa adanya
  }
  fail(name, evidence);
}

// Sengaja memakai build produksi, bukan `next dev`: overlay error milik
// mode dev menutupi halaman dan membuat klik gagal, dan yang ingin diuji
// memang versi yang benar-benar dipakai pengguna. NEXT_PUBLIC_* ditanam
// saat build, jadi env-nya harus sama persis di build dan start.
const APP_ENV = {
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
  // Nilai dummy: dalam mode emulator tidak ada permintaan ke Firebase
  // sungguhan, tapi SDK tetap menolak inisialisasi tanpa apiKey.
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
  // Kalau port sudah dipakai proses lain, JANGAN diteruskan: server baru
  // gagal bind, tapi pengecekan kesiapan tetap lolos karena yang menjawab
  // server lama. Akibatnya uji ini bisa melaporkan hijau padahal yang
  // diuji kode lama — kegagalan yang jauh lebih berbahaya daripada macet.
  if (await isPortTaken(3100)) {
    throw new Error(
      'Port 3100 sudah dipakai proses lain. Hentikan dulu (mis. sisa "next dev"/"next start" ' +
        'dari percobaan sebelumnya), supaya uji ini tidak menguji server yang salah.'
    );
  }

  await buildApp();
  console.log('→ Menjalankan server...');
  // detached: true supaya seluruh grup proses (npx -> next -> node) bisa
  // dimatikan sekaligus. Tanpa ini, SIGTERM hanya membunuh pembungkus npx
  // dan server aslinya tetap hidup menahan port untuk run berikutnya.
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
      // server belum siap
    }
    await sleep(1000);
  }
  throw new Error('Next.js tidak kunjung siap dalam 90 detik.');
}

// Mematikan seluruh grup proses, bukan hanya pembungkus npx — kalau server
// aslinya lolos hidup, ia akan menahan port 3100 dan membuat percobaan
// berikutnya diam-diam menguji server yang salah.
function stopServer(server) {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    try {
      server.kill('SIGKILL');
    } catch {
      // proses memang sudah mati
    }
  }
}

async function run() {
  const server = await startAppServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // Guru dan siswa memakai konteks browser terpisah — sesi auth mereka
  // memang harus terpisah, persis seperti perangkat yang berbeda.
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
    // ---------- 1. Guru mendaftar & membuat workspace ----------
    console.log('\n→ Alur guru');
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    // Ada dua field password (Kata Sandi + Konfirmasi) sejak audit UX — pakai
    // placeholder, bukan `input[type="password"]`, supaya tidak diam-diam
    // hanya mengisi field pertama dan lolos validasi konfirmasi kosong.
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    pass('Guru mendaftar dan workspace terbuat');

    // ---------- 2. Guru menambah siswa ----------
    // Sejak pemisahan UI Tambah Kelas/Tambah Siswa, form "Tambah 1 Siswa"
    // ada di dalam modal "Tambah Kelas Baru", bukan langsung tampil di
    // /classes. Karena belum ada kelas sama sekali, field kelas di dalam
    // modal ini muncul sebagai input "Nama Kelas (Baru)", bukan dropdown.
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('12345');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(4000);

    const classCardVisible = await teacher.getByText(`${CLASS_NAME}`, { exact: true }).count();
    if (classCardVisible > 0) pass('Guru menambah siswa', `kelas ${CLASS_NAME} muncul`);
    else fail('Guru menambah siswa', 'kartu kelas tidak muncul setelah siswa disimpan');

    // ---------- 3. Kode akses tampil & bisa dibaca ----------
    const classCard = teacher.getByText(`${CLASS_NAME}`, { exact: true }).first();
    if (await classCard.count()) {
      await classCard.click();
      await teacher.waitForTimeout(3000);
    }
    // Judul spesifik (bukan substring "kode akses" saja) — sejak fitur
    // "Salin Semua Kode" ditambahkan, judulnya ("Salin semua kode akses
    // siswa...") juga cocok dengan substring itu dan render LEBIH DULU di
    // DOM daripada tombol kode per-siswa, sehingga `.first()` salah
    // menangkap tombol bulk-copy alih-alih kode akses siswa sungguhan.
    const codeButton = teacher.locator('button[title="Salin kode akses Student Companion"]').first();
    if (await codeButton.count()) {
      accessCode = (await codeButton.innerText()).trim().split('\n')[0].trim();
      pass('Kode akses siswa tampil untuk guru', accessCode);
    } else {
      fail('Kode akses siswa tampil untuk guru', 'tombol kode tidak ditemukan di detail kelas');
    }

    // ---------- 4. Guru membuat tugas ----------
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=tugas`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(3000);
    const createAssignment = teacher.getByRole('button', { name: /Buat Tugas/i }).first();
    if (await createAssignment.count()) {
      await createAssignment.click();
      await teacher.waitForTimeout(800);
      await teacher.fill('input[placeholder*="Latihan Soal"]', ASSIGNMENT_TITLE);
      await teacher.fill('input[type="date"]', '2026-12-31');
      // Materi soal sekaligus jadi bukti storage.rules path baru
      // (assignment-materials/) benar-benar bisa ditulis guru, bukan cuma
      // lolos compile.
      await teacher.locator('input[type="file"]').first().setInputFiles({
        name: 'soal-bab-3.png',
        mimeType: 'image/png',
        buffer: ONE_PIXEL_PNG,
      });
      // Sejak Draft→Preview→Publish (spec "Workflow Mengajar — Rencana
      // Lanjutan"), submit form tidak langsung menyimpan — ada layar
      // Preview dulu sebelum tombol "Publish Tugas" benar-benar menulis
      // ke Firestore.
      await teacher.getByRole('button', { name: /^Preview$/i }).click();
      await teacher.waitForTimeout(500);
      await teacher.getByRole('button', { name: /^Publish Tugas$/i }).click();
      await teacher.waitForTimeout(4000);
      const created = await teacher.getByText(ASSIGNMENT_TITLE).count();
      if (created > 0) pass('Guru membuat tugas dengan materi terlampir');
      else fail('Guru membuat tugas dengan materi terlampir', 'tugas tidak muncul di daftar setelah disimpan');
    } else {
      fail('Guru membuat tugas dengan materi terlampir', 'tombol "Buat Tugas" tidak ditemukan');
    }

    // ---------- 5. Siswa masuk pakai kode akses ----------
    console.log('\n→ Alur siswa');
    if (!accessCode) {
      fail('Siswa masuk dengan kode akses', 'dilewati: kode akses tidak didapat');
    } else {
      await student.goto(`${BASE_URL}/student/login`, { waitUntil: 'domcontentloaded' });
      await student.fill('input[placeholder*="CONTOH"]', accessCode);
      await student.getByRole('button', { name: /Masuk/i }).click();
      try {
        await student.waitForURL(`${BASE_URL}/student`, { timeout: 25000 });
        // Sampai di /student saja belum cukup: pernah terjadi siswa masuk,
        // muncul sekejap di beranda, lalu dilempar balik ke halaman login
        // karena profilnya belum termuat. Jadi dicek juga bahwa ia BERTAHAN
        // di sana.
        await student.waitForTimeout(3000);
        if (student.url().includes('/student/login')) {
          await failWithEvidence(
            student,
            'Siswa masuk dengan kode akses',
            'sempat masuk lalu dilempar balik ke halaman login'
          );
        } else {
          pass('Siswa masuk dengan kode akses');
        }
      } catch {
        const errorText = await student.locator('.text-red-600').first().innerText().catch(() => '');
        fail('Siswa masuk dengan kode akses', errorText || 'tidak diarahkan ke /student');
      }
    }

    // ---------- 6. Siswa melihat namanya & tugas dari guru ----------
    if (student.url().includes('/student')) {
      await student.waitForTimeout(2500);
      const nameShown = await student.getByText(STUDENT_NAME).count();
      if (nameShown > 0) pass('Beranda siswa menampilkan identitasnya');
      else await failWithEvidence(student, 'Beranda siswa menampilkan identitasnya', 'nama siswa tidak muncul');

      // Navigasi lewat bottom nav sungguhan (bukan goto langsung ke URL) —
      // "Profil" adalah satu-satunya jalan siswa menjangkau tombol Keluar,
      // jadi kalau item ini hilang lagi dari StudentBottomNav, test ini
      // yang menangkap (bukan cuma ketahuan lewat laporan pengguna).
      await student.getByRole('link', { name: /^Profil$/i }).click();
      await student.waitForURL(`${BASE_URL}/student/profil`, { timeout: 10000 }).catch(() => {});
      if (student.url().includes('/student/profil')) {
        const logoutButton = student.getByTitle(/Keluar/i).first();
        if (await logoutButton.count()) pass('Siswa bisa menjangkau tombol Keluar lewat bottom nav');
        else fail('Siswa bisa menjangkau tombol Keluar lewat bottom nav', 'halaman Profil terbuka tapi tombol Keluar tidak ditemukan');
      } else {
        await failWithEvidence(
          student,
          'Siswa bisa menjangkau tombol Keluar lewat bottom nav',
          'klik "Profil" di bottom nav tidak membuka /student/profil'
        );
      }

      await student.goto(`${BASE_URL}/student/tugas`, { waitUntil: 'domcontentloaded' });
      await student.waitForTimeout(3000);
      const assignmentVisible = await student.getByText(ASSIGNMENT_TITLE).count();
      if (assignmentVisible > 0) pass('Siswa melihat tugas yang dibuat guru');
      else fail('Siswa melihat tugas yang dibuat guru', 'tugas tidak muncul di aplikasi siswa');

      const materialLink = student.getByRole('link', { name: /soal-bab-3\.png/i }).first();
      if (await materialLink.count()) {
        const href = await materialLink.getAttribute('href');
        try {
          const res = await fetch(href);
          if (res.ok) pass('Siswa bisa membuka materi soal dari guru', `HTTP ${res.status}`);
          else fail('Siswa bisa membuka materi soal dari guru', `unduhan gagal: HTTP ${res.status}`);
        } catch (err) {
          fail('Siswa bisa membuka materi soal dari guru', `unduhan error: ${err.message}`);
        }
      } else {
        await failWithEvidence(
          student,
          'Siswa bisa membuka materi soal dari guru',
          'tautan materi tidak muncul di halaman tugas siswa'
        );
      }

      // ---------- 7. Siswa mengumpulkan jawaban ----------
      const submitButton = student.getByRole('button', { name: /Kerjakan Tugas/i }).first();
      if (await submitButton.count()) {
        await submitButton.click();
        await student.waitForTimeout(600);
        await student.fill('textarea', 'Ini jawaban saya untuk latihan bab 3.');
        await student.getByRole('button', { name: /^Kirim Tugas$/i }).last().click();
        await student.waitForTimeout(4000);
        const waiting = await student.getByText(/Sudah dikumpulkan/i).count();
        if (waiting > 0) pass('Siswa mengumpulkan jawaban');
        else fail('Siswa mengumpulkan jawaban', 'status tidak berubah jadi "Sudah dikumpulkan"');
      } else {
        fail('Siswa mengumpulkan jawaban', 'tombol "Kerjakan Tugas" tidak ditemukan');
      }

      // ---------- 7b. Siswa melampirkan BEBERAPA file sekaligus ----------
      // Sengaja sebagai pengumpulan KEDUA (mengubah jawaban), bukan
      // digabung ke langkah di atas: dengan begitu jalur "kumpul teks
      // saja" dan jalur "unggah file" dua-duanya terlewati, termasuk
      // aturan bahwa lampiran lama tidak hilang saat jawaban diperbaiki.
      // Dua file dipilih SEKALIGUS (bukan satu-satu) supaya benar-benar
      // menguji fitur multi-foto (maks 5): input multiple, upload paralel
      // dengan prefix unik per file, dan penyimpanan/rendering array
      // `attachments` di kedua sisi (siswa & guru) — bukan cuma jalur
      // lampiran tunggal yang lama.
      const editButton = student.getByRole('button', { name: /Ubah Pengumpulan/i }).first();
      if (await editButton.count()) {
        await editButton.click();
        await student.waitForTimeout(600);
        // File dibuat di memori, tidak menyentuh disk. PNG 1x1 asli
        // supaya contentType-nya benar-benar lolos Storage rules.
        await student.locator('input[type="file"]').first().setInputFiles([
          { name: 'jawaban-tulis-tangan-1.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG },
          { name: 'jawaban-tulis-tangan-2.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG },
        ]);
        await student.waitForTimeout(500);
        await student.getByRole('button', { name: /^Kirim Tugas$/i }).last().click();
        // Unggah 2 file + getDownloadURL butuh waktu lebih lama daripada
        // tulis Firestore biasa.
        await student.waitForTimeout(10000);

        const attachment1Visible = await student.getByText(/jawaban-tulis-tangan-1\.png/i).count();
        const attachment2Visible = await student.getByText(/jawaban-tulis-tangan-2\.png/i).count();
        if (attachment1Visible > 0 && attachment2Visible > 0) {
          pass('Siswa melampirkan 2 foto sekaligus dan keduanya tersimpan');
        } else {
          await failWithEvidence(
            student,
            'Siswa melampirkan 2 foto sekaligus dan keduanya tersimpan',
            `lampiran hilang setelah dikumpulkan (file1=${attachment1Visible}, file2=${attachment2Visible})`
          );
        }
      } else {
        fail('Siswa melampirkan 2 foto sekaligus dan keduanya tersimpan', 'tombol "Ubah Pengumpulan" tidak ditemukan');
      }

      // ---------- 8. Siswa melihat halaman lain tanpa error ----------
      for (const [path, label] of [
        ['/student/jadwal', 'Jadwal'],
        ['/student/nilai', 'Nilai'],
        ['/student/presensi', 'Kehadiran'],
        ['/student/profil', 'Profil'],
      ]) {
        await student.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
        await student.waitForTimeout(2000);
        const heading = await student.getByRole('heading', { name: new RegExp(label, 'i') }).count();
        if (heading > 0) pass(`Halaman siswa "${label}" terbuka`);
        else fail(`Halaman siswa "${label}" terbuka`, 'judul halaman tidak ditemukan');
      }
    }

    // ---------- 9. Guru melihat jawaban & memberi nilai ----------
    console.log('\n→ Guru menilai');
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=tugas`, {
      waitUntil: 'domcontentloaded',
    });
    await teacher.waitForTimeout(3000);
    const assignmentRow = teacher.getByText(ASSIGNMENT_TITLE).first();
    if (await assignmentRow.count()) {
      await assignmentRow.click();
      await teacher.waitForTimeout(3000);
      // Isi pengumpulan kini ditampilkan di dalam panel Review, bukan
      // langsung di daftar — guru wajib membukanya sebelum menilai.
      const openReview = teacher.getByRole('button', { name: /^Review$/i }).first();
      if (await openReview.count()) {
        await openReview.click();
        await teacher.waitForTimeout(1500);
      }
      const answerVisible = await teacher.getByText(/Ini jawaban saya/i).count();
      if (answerVisible > 0) pass('Guru melihat jawaban siswa');
      else fail('Guru melihat jawaban siswa', 'teks jawaban tidak muncul di panel penilaian');

      // Kedua lampiran harus bisa dibuka guru, bukan sekadar tersimpan.
      // Guru membacanya lewat download URL bertoken (bukan lewat Storage
      // rules), jadi bagian ini yang membuktikan rantai `attachments`
      // (array, bukan cuma fileUrl tunggal) utuh sampai ke panel guru.
      let bothAttachmentsOpenable = true;
      for (const fileName of ['jawaban-tulis-tangan-1.png', 'jawaban-tulis-tangan-2.png']) {
        const attachmentLink = teacher.getByRole('link', { name: new RegExp(fileName.replace('.', '\\.'), 'i') }).first();
        if (await attachmentLink.count()) {
          const href = await attachmentLink.getAttribute('href');
          try {
            const res = await fetch(href);
            if (!res.ok) {
              bothAttachmentsOpenable = false;
              console.log(`  ⚠ ${fileName}: unduhan gagal HTTP ${res.status}`);
            }
          } catch (err) {
            bothAttachmentsOpenable = false;
            console.log(`  ⚠ ${fileName}: unduhan error ${err.message}`);
          }
        } else {
          bothAttachmentsOpenable = false;
          console.log(`  ⚠ ${fileName}: tautan tidak muncul di panel penilaian`);
        }
      }
      if (bothAttachmentsOpenable) pass('Guru bisa membuka kedua lampiran siswa');
      else await failWithEvidence(teacher, 'Guru bisa membuka kedua lampiran siswa', 'lihat detail di atas');

      // Sejak "Review sebelum nilai", menilai hanya mungkin dari dalam
      // panel review (guru harus melihat pekerjaannya dulu — panelnya
      // sudah terbuka di langkah sebelumnya), dan nilai baru tertulis
      // setelah dikonfirmasi.
      const scoreField = teacher.locator('input[placeholder="Nilai"]').first();
      if (await scoreField.count()) {
        await scoreField.fill('88');
        await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).first().click();
        await teacher.waitForTimeout(800);
        await teacher.getByRole('button', { name: /^Simpan Nilai$/i }).last().click();
        await teacher.waitForTimeout(4000);
        const graded = await teacher.getByText(/Nilai 88/i).count();
        if (graded > 0) pass('Guru memberi nilai');
        else fail('Guru memberi nilai', 'nilai tidak muncul setelah disimpan');
      } else {
        fail('Guru memberi nilai', 'kolom Nilai tidak ditemukan di panel review');
      }
    } else {
      fail('Guru melihat jawaban siswa', 'tugas tidak ditemukan di daftar');
    }

    // ---------- 10. Nilai sampai ke siswa (dan ke gradebook) ----------
    console.log('\n→ Nilai sampai ke siswa');
    if (student.url().includes('/student')) {
      await student.goto(`${BASE_URL}/student/nilai`, { waitUntil: 'domcontentloaded' });
      await student.waitForTimeout(3500);
      const scoreVisible = await student.getByText('88').count();
      if (scoreVisible > 0) pass('Nilai otomatis muncul di halaman Nilai siswa');
      else fail('Nilai otomatis muncul di halaman Nilai siswa', 'angka 88 tidak ditemukan');
    }
  } catch (error) {
    fail('Alur uji berhenti karena error tak terduga', error.message);
  } finally {
    await browser.close();
    stopServer(server);
  }

  // ---------- Ringkasan ----------
  console.log('\n' + '='.repeat(60));
  const failed = steps.filter((s) => !s.ok);
  console.log(`HASIL: ${steps.length - failed.length}/${steps.length} langkah berhasil`);
  if (failed.length > 0) {
    console.log('\nGagal:');
    failed.forEach((s) => console.log(`  - ${s.name}: ${s.detail}`));
  }

  const realErrors = consoleErrors.filter(
    (e) => !/favicon|Download the React DevTools|Failed to load resource/i.test(e)
  );
  if (realErrors.length > 0) {
    console.log(`\nError di console browser (${realErrors.length}):`);
    [...new Set(realErrors)].slice(0, 15).forEach((e) => console.log(`  - ${e}`));
  }
  console.log('='.repeat(60));

  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('Uji gagal dijalankan:', error);
  process.exit(1);
});
