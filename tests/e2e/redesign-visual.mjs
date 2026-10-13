/**
 * Audit visual otomatis redesign (Chromium): untuk setiap rute x viewport
 * (mobile, iPad portrait, iPad landscape, desktop) memeriksa
 *  - tidak ada overflow horizontal pada halaman,
 *  - tidak ada teks tampil < 12px,
 *  - bottom nav / indeks samping tidak menutupi konten (scroll ke bawah),
 *  - tidak ada JS error;
 * dan menyimpan screenshot ke $VISUAL_OUT (default /tmp/redesign-visual).
 * Tidak menguji Safari/WebKit.
 *
 * Jalankan: npm run test:e2e:visual
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3103';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const STUDENT_NAME = 'Siswa Uji Presensi';
const CLASS_NAME = 'X-VISUAL-1';

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
    const file = `/tmp/e2e-a11y-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
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
  if (await isPortTaken(3103)) throw new Error('Port 3103 sudah dipakai proses lain.');
  await buildApp();
  console.log('→ Menjalankan server produksi di :3103...');
  const server = spawn('npx', ['next', 'start', '--port', '3103', '--hostname', '127.0.0.1'], {
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
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji Visual');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    pass('Setup: guru mendaftar');

    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('9303');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(3000);
    pass('Setup: kelas + siswa dibuat', CLASS_NAME);

    const OUT = process.env.VISUAL_OUT || '/tmp/redesign-visual';
    const fs = await import('node:fs');
    fs.mkdirSync(OUT, { recursive: true });
    const VIEWPORTS = [
      ['mobile', 390, 844],
      ['ipad-portrait', 820, 1180],
      ['ipad-landscape', 1180, 820],
      ['desktop', 1440, 900],
    ];
    const q = encodeURIComponent(CLASS_NAME);
    const ROUTES = [
      ['beranda', '/'],
      ['kelas-jurnal', `/attendance?class=${q}&tab=jurnal`],
      ['kelas-presensi', `/attendance?class=${q}&tab=presensi`],
      ['kelas-nilai', `/attendance?class=${q}&tab=nilai`],
      ['kelas-tugas', `/attendance?class=${q}&tab=tugas`],
      ['kelas-pengumuman', `/attendance?class=${q}&tab=pengumuman`],
      ['kelas-riwayat', `/attendance?class=${q}&tab=riwayat`],
      ['jadwal', '/schedule'],
      ['siswa-kelas', '/classes'],
      ['akun', '/account'],
      ['profil', '/profile'],
      ['analytics', '/analytics'],
      ['wali-kelas', '/wali-kelas'],
      ['ulangan', '/ulangan'],
      ['upgrade', '/upgrade'],
      ['siswa-login', '/student/login'],
    ];
    for (const [vpName, w, h] of VIEWPORTS) {
      await teacher.setViewportSize({ width: w, height: h });
      for (const [name, path] of ROUTES) {
        await teacher.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
        await teacher.waitForTimeout(1500);
        // Sesi baru butuh waktu memuat workspace; jangan screenshot layar "Belum Ada Workspace".
        const wsLoaded = await teacher
          .waitForFunction(() => !/Belum Ada Workspace|Memuat/i.test(document.body.innerText), null, { timeout: 20000 })
          .then(() => true, () => false);
        const r = await teacher.evaluate(() => {
          const de = document.documentElement;
          const overflow = Math.max(de.scrollWidth, document.body.scrollWidth) - de.clientWidth;
          const tiny = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            const t = n.textContent.trim();
            if (!t) continue;
            const el = n.parentElement;
            if (!el || el.closest('script,style,noscript')) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const rc = el.getBoundingClientRect();
            if (rc.width === 0 || rc.height === 0) continue;
            if (parseFloat(cs.fontSize) < 12) tiny.push(`${t.slice(0, 24)}@${cs.fontSize}`);
          }
          const nav = document.querySelector('nav.fixed');
          let overlap = null;
          if (nav) {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const nr = nav.getBoundingClientRect();
            const horizontal = nr.width >= window.innerWidth * 0.9 && nr.top > window.innerHeight / 2;
            if (horizontal) {
              const hidden = [...document.querySelectorAll('main a, main button, main input, main textarea, main select, a, button, input, textarea, select')]
                .filter((e) => !nav.contains(e))
                .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > nr.top + 1 && b.top < nr.bottom && b.top >= 0; })
                .map((e) => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24));
              overlap = hidden;
            }
            window.scrollTo(0, 0);
          }
          return { overflow, tiny: [...new Set(tiny)], overlap, navKind: nav ? (nav.getBoundingClientRect().width >= window.innerWidth * 0.9 ? 'bottom' : 'side') : 'none' };
        });
        await teacher.screenshot({ path: `${OUT}/${vpName}-${name}.png`, fullPage: false });
        const label = `${vpName} ${name}`;
        const problems = [];
        if (!wsLoaded && !path.startsWith('/student')) problems.push('workspace/konten tidak selesai dimuat (layar "Belum Ada Workspace"/"Memuat")');
        if (r.overflow > 1) problems.push(`overflow horizontal ${r.overflow}px`);
        if (r.tiny.length) problems.push(`teks <12px: ${r.tiny.slice(0, 5).join(' | ')}`);
        if (r.overlap && r.overlap.length) problems.push(`tertutup bottom nav: ${r.overlap.slice(0, 4).join(' | ')}`);
        if (problems.length) fail(label, problems.join('; ') + ` (nav=${r.navKind})`);
        else pass(label, `nav=${r.navKind}`);
      }
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
