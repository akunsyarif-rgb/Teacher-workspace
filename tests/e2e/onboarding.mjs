/**
 * Uji alur onboarding workspace sekolah di browser sungguhan, dijalankan di
 * atas Firebase Emulator.
 *
 * Kenapa ada: audit T2 (join workspace via invite code) sudah diverifikasi
 * di level Firestore Security Rules (tests/firestore-rules.test.ts), tapi
 * itu belum membuktikan alur onboarding SEKOLAH yang sesungguhnya bisa
 * ditempuh lewat UI nyata — mulai dari membuat sekolah, guru
 * owner mendapatkan kode undangan, sampai guru lain join dan datanya
 * benar-benar terisolasi dari workspace lain. Ini file test terpisah dari
 * smoke.mjs (bukan pengganti) karena mewakili skenario multi-akun yang
 * berbeda: onboarding SEKOLAH (bukan individual), bukan alur guru+siswa
 * satu workspace.
 *
 * Jalankan: npm run test:e2e:onboarding
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

const BASE_URL = 'http://127.0.0.1:3100';
const OWNER_EMAIL = `owner${Date.now()}@sekolah-uji.sch.id`;
const JOINER_EMAIL = `joiner${Date.now()}@sekolah-uji.sch.id`;
const OUTSIDER_EMAIL = `outsider${Date.now()}@lain.sch.id`;
const PASSWORD = 'rahasia123';
const SCHOOL_NAME = 'SMA Uji Onboarding';
const CLASS_NAME = 'X-IPA-9';
const STUDENT_NAME = 'Siti Aminah';

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
    const file = `/tmp/e2e-onboarding-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
    evidence = `${detail} | layar: ${file} | teks halaman: "${text}"`;
  } catch {
    // halaman mungkin sudah tertutup — pakai detail apa adanya
  }
  fail(name, evidence);
}

// Sama seperti smoke.mjs: build produksi sungguhan, mode emulator.
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
  if (await isPortTaken(3100)) {
    throw new Error(
      'Port 3100 sudah dipakai proses lain. Hentikan dulu (mis. sisa "next dev"/"next start" ' +
        'dari percobaan sebelumnya), supaya uji ini tidak menguji server yang salah.'
    );
  }

  await buildApp();
  console.log('→ Menjalankan server...');
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

// Workspace sekolah baru cuma dapat FREE_SEAT_LIMIT = 1 kursi (pemilik
// saja) sampai owner benar-benar membeli kursi tambahan lewat halaman
// upgrade (Midtrans — tidak tersedia di emulator lokal). Supaya skenario
// "guru kedua join" bisa diuji tanpa mensimulasikan pembayaran sungguhan,
// seatLimit dinaikkan langsung di Firestore lewat rules-unit-testing
// (withSecurityRulesDisabled) — persis pola seed() di
// tests/firestore-rules.test.ts, murni utk persiapan data uji, BUKAN
// jalur yang dipakai aplikasi sungguhan.
async function bumpSeatLimitForTesting(inviteCode, newSeatLimit) {
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-teacher-workspace',
    firestore: { host: 'localhost', port: 8080 },
  });
  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const bridgeSnap = await getDoc(doc(db, 'workspace_invites', inviteCode));
      const workspaceId = bridgeSnap.exists() ? bridgeSnap.data().workspaceId : null;
      if (!workspaceId) throw new Error(`Tidak menemukan workspaceId untuk kode ${inviteCode}`);
      await updateDoc(doc(db, 'workspaces', workspaceId), { seatLimit: newSeatLimit });
    });
  } finally {
    await testEnv.cleanup();
  }
}

async function signup(page, { email, mode, workspaceName, inviteCode }) {
  await page.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
  if (mode !== 'individual') {
    const modeLabel = mode === 'school' ? 'Sekolah' : 'Gabung';
    await page.getByRole('button', { name: new RegExp(`^${modeLabel}$`, 'i') }).click();
  }
  await page.fill('input[type="email"]', email);
  await page.fill('input[placeholder="Minimal 6 karakter"]', PASSWORD);
  await page.fill('input[placeholder="Ulangi kata sandi"]', PASSWORD);
  if (mode === 'individual' || mode === 'school') {
    await page.fill('input[placeholder*="SMA Negeri"], input[placeholder*="Kelas Pak"]', workspaceName);
  } else {
    await page.fill('input[placeholder*="AB3D9F"]', inviteCode);
  }
  await page.click('button[type="submit"]');
}

async function run() {
  const server = await startAppServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // Tiga persona, tiga konteks browser terpisah — mewakili tiga perangkat
  // berbeda, sama seperti pemisahan guru/siswa di smoke.mjs.
  const ownerCtx = await browser.newContext();
  const joinerCtx = await browser.newContext();
  const outsiderCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const joiner = await joinerCtx.newPage();
  const outsider = await outsiderCtx.newPage();

  const consoleErrors = [];
  for (const [label, page] of [['owner', owner], ['joiner', joiner], ['outsider', outsider]]) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${label}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`[${label}] ${err.message}`));
  }

  let inviteCode = null;

  try {
    // ---------- 1. Create School ----------
    console.log('\n→ Onboarding sekolah');
    await signup(owner, { email: OWNER_EMAIL, mode: 'school', workspaceName: SCHOOL_NAME });
    try {
      await owner.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
      pass('Create School: guru owner mendaftar dan workspace sekolah terbuat');
    } catch {
      await failWithEvidence(
        owner,
        'Create School: guru owner mendaftar dan workspace sekolah terbuat',
        'tidak diarahkan ke beranda setelah daftar'
      );
    }

    // Kelas contoh — dibutuhkan supaya langkah "verify workspace membership"
    // & "verify workspace isolation" di bawah punya data nyata utk dicek,
    // bukan sekadar mengecek redirect berhasil.
    if (owner.url() === `${BASE_URL}/`) {
      await owner.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
      await owner.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
      const addForm = owner.locator('form').first();
      await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
      await addForm.locator('input').nth(1).fill('99887');
      await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
      await owner.getByRole('button', { name: /Simpan Siswa/i }).click();
      await owner.waitForTimeout(4000);

      const classVisible = await owner.getByText(CLASS_NAME, { exact: true }).count();
      if (classVisible > 0) pass('Owner menambah kelas contoh', CLASS_NAME);
      else fail('Owner menambah kelas contoh', 'kelas tidak muncul setelah siswa disimpan');
    }

    // ---------- 2. Generate/obtain invite code ----------
    await owner.goto(`${BASE_URL}/account`, { waitUntil: 'domcontentloaded' });
    await owner.waitForTimeout(3000);
    const copyButton = owner.getByTitle('Salin kode undangan');
    if (await copyButton.count()) {
      const codeSpan = copyButton.locator('xpath=preceding-sibling::span[1]');
      inviteCode = (await codeSpan.innerText()).trim();
      pass('Generate/obtain invite code', inviteCode);

      // Lihat komentar bumpSeatLimitForTesting: workspace sekolah baru
      // cuma py 1 kursi (pemilik) sampai owner beli kursi tambahan — perlu
      // dinaikkan supaya skenario "guru kedua join" di bawah bisa diuji.
      await bumpSeatLimitForTesting(inviteCode, 5);
    } else {
      await failWithEvidence(
        owner,
        'Generate/obtain invite code',
        'kartu "Kode Undangan Sekolah" tidak muncul di /account'
      );
    }

    // ---------- 3. Logout ----------
    const logoutButton = owner.getByRole('button', { name: /Keluar/i });
    if (await logoutButton.count()) {
      await logoutButton.click();
      await owner.waitForURL(`${BASE_URL}/login`, { timeout: 15000 }).catch(() => {});
      if (owner.url().includes('/login')) pass('Logout: owner diarahkan ke /login');
      else await failWithEvidence(owner, 'Logout: owner diarahkan ke /login', 'tidak diarahkan ke /login setelah klik Keluar');
    } else {
      fail('Logout: owner diarahkan ke /login', 'tombol Keluar tidak ditemukan di /account');
    }

    // ---------- 4/5. Register guru baru & join workspace pakai kode ----------
    console.log('\n→ Guru baru join lewat kode undangan');
    if (!inviteCode) {
      fail('Register guru baru & join workspace pakai kode', 'dilewati: kode undangan tidak didapat');
    } else {
      await signup(joiner, { email: JOINER_EMAIL, mode: 'join', inviteCode });
      try {
        await joiner.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
        pass('Register guru baru & join workspace pakai kode');
      } catch {
        const errorText = await joiner.locator('.text-red-600').first().innerText().catch(() => '');
        await failWithEvidence(
          joiner,
          'Register guru baru & join workspace pakai kode',
          errorText || 'tidak diarahkan ke beranda setelah join'
        );
      }
    }

    // ---------- 6. Verify workspace membership ----------
    if (joiner.url() === `${BASE_URL}/`) {
      await joiner.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
      await joiner.waitForTimeout(3000);
      const sharedClassVisible = await joiner.getByText(CLASS_NAME, { exact: true }).count();
      if (sharedClassVisible > 0) {
        pass('Verify workspace membership: guru baru melihat kelas milik workspace sekolah yang sama');
      } else {
        await failWithEvidence(
          joiner,
          'Verify workspace membership: guru baru melihat kelas milik workspace sekolah yang sama',
          `kelas ${CLASS_NAME} tidak terlihat — join mungkin gagal terhubung ke workspace yang benar`
        );
      }
    } else {
      fail(
        'Verify workspace membership: guru baru melihat kelas milik workspace sekolah yang sama',
        'dilewati: join sebelumnya gagal'
      );
    }

    // ---------- 7. Verify workspace isolation ----------
    // Guru ketiga yang SAMA SEKALI tidak berhubungan (workspace individual
    // sendiri) tidak boleh bisa melihat kelas milik workspace sekolah di
    // atas — ini pembuktian isolasi multi-tenant di level UI nyata, bukan
    // cuma di level Firestore Rules (yang sudah dicek terpisah).
    console.log('\n→ Verifikasi isolasi workspace');
    await signup(outsider, { email: OUTSIDER_EMAIL, mode: 'individual', workspaceName: 'Workspace Tidak Terkait' });
    try {
      await outsider.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
      await outsider.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
      await outsider.waitForTimeout(3000);
      const leakedClassVisible = await outsider.getByText(CLASS_NAME, { exact: true }).count();
      if (leakedClassVisible === 0) {
        pass('Verify workspace isolation: guru tak terkait TIDAK melihat kelas workspace sekolah lain');
      } else {
        await failWithEvidence(
          outsider,
          'Verify workspace isolation: guru tak terkait TIDAK melihat kelas workspace sekolah lain',
          `kelas ${CLASS_NAME} BOCOR terlihat di workspace yang tidak terkait — pelanggaran isolasi tenant`
        );
      }
    } catch {
      await failWithEvidence(
        outsider,
        'Verify workspace isolation: guru tak terkait TIDAK melihat kelas workspace sekolah lain',
        'guru pembanding gagal mendaftar/masuk beranda'
      );
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
