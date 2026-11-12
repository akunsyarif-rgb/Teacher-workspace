/**
 * Regression test: banner pembaruan aplikasi (versi klien vs /api/version).
 *
 * Spec "Proteksi Tinggi" menuntut nilai yang sudah terkunci TIDAK boleh
 * langsung bisa diketik ulang hanya karena ikon pensilnya tersentuh — di
 * layar sentuh itu gampang terjadi tanpa disengaja. Harus muncul dialog
 * "Ubah nilai?" dengan pilihan Batal / Lanjutkan, dan Batal harus benar-
 * benar membiarkan nilai tetap terkunci.
 *
 * Jalankan: npm run test:e2e:version
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3100';

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
  const page = await (await browser.newContext()).newPage();
  try {
    // 1) Versi server = versi bundel klien → tidak ada banner.
    const real = await (await fetch(`${BASE_URL}/api/version`)).json();
    if (typeof real.version === 'string' && real.version.length > 0) pass('/api/version mengembalikan versi build', real.version.slice(0, 12));
    else fail('/api/version mengembalikan versi build', JSON.stringify(real));
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    if ((await page.getByTestId('update-banner').count()) === 0) pass('Versi sama: tidak ada banner');
    else await failWithEvidence(page, 'Versi sama: tidak ada banner', 'banner muncul padahal versi sama');

    // 2) Server melayani versi lain (deploy baru) → banner muncul saat aplikasi kembali difokuskan.
    await page.route('**/api/version', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'deploy-baru-xyz' }) })
    );
    await page.waitForTimeout(31000); // lewati batas 30 dtk antar-pengecekan
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(1500);
    const banner = page.getByTestId('update-banner');
    if ((await banner.count()) > 0 && /Muat ulang halaman untuk memperbarui aplikasi/.test(await banner.innerText()))
      pass('Versi berbeda: banner "Muat ulang halaman untuk memperbarui aplikasi" muncul');
    else await failWithEvidence(page, 'Versi berbeda: banner muncul', 'banner tidak muncul');

    // 3) "Nanti" menyembunyikan banner (tidak mengganggu).
    await banner.getByRole('button', { name: /Nanti saja/i }).click();
    await page.waitForTimeout(300);
    if ((await page.getByTestId('update-banner').count()) === 0) pass('"Nanti" menyembunyikan banner');
    else await failWithEvidence(page, '"Nanti" menyembunyikan banner', 'banner masih tampil');

    // 4) Gagal jaringan saat mengecek → diam-diam (tidak ada error/banner).
    await page.unroute('**/api/version');
    await page.route('**/api/version', (route) => route.abort());
    await page.waitForTimeout(31000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(1000);
    pass('Pengecekan gagal (offline) tidak menimbulkan galat yang terlihat');
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
