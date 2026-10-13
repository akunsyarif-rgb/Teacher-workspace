/**
Uji aksesibilitas + keyboard untuk 6 tab Pusat Kegiatan Kelas (pola WAI-ARIA
Tabs, aktivasi manual): role tablist/tab/tabpanel, aria-selected,
aria-controls/aria-labelledby, roving tabindex, panah/Home/End, Enter/Spasi,
klik, dan deep-link ?tab=.

Jalankan: npm run test:e2e:class-tabs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';

const BASE_URL = 'http://127.0.0.1:3102';
const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const STUDENT_NAME = 'Siswa Uji Presensi';
const CLASS_NAME = 'X-A11Y-1';

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
  if (await isPortTaken(3102)) throw new Error('Port 3102 sudah dipakai proses lain.');
  await buildApp();
  console.log('→ Menjalankan server produksi di :3102...');
  const server = spawn('npx', ['next', 'start', '--port', '3102', '--hostname', '127.0.0.1'], {
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
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji A11y');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    pass('Setup: guru mendaftar');

    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const addForm = teacher.locator('form').first();
    await addForm.locator('input').nth(0).fill(STUDENT_NAME, { timeout: 20000 });
    await addForm.locator('input').nth(1).fill('9202');
    await addForm.locator('input[placeholder*="TEKNIK"]').fill(CLASS_NAME);
    await teacher.getByRole('button', { name: /Simpan Siswa/i }).click();
    await teacher.waitForTimeout(3000);
    pass('Setup: kelas + siswa dibuat', CLASS_NAME);

    // ---------- Pola WAI-ARIA Tabs pada Pusat Kegiatan Kelas ----------
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=jurnal`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('tablist', { name: 'Pusat Kegiatan Kelas' }).waitFor({ timeout: 30000 });
    const tabs = teacher.getByRole('tab');
    const names = ['Jurnal Mengajar', 'Presensi', 'Nilai', 'Tugas', 'Pengumuman', 'Riwayat'];
    const got = await tabs.allInnerTexts();
    const cleaned = got.map((t) => t.trim());
    if (JSON.stringify(cleaned) === JSON.stringify(names)) pass('Ada tepat 6 tab dengan nama aksesibel yang benar', cleaned.join(', '));
    else fail('Ada tepat 6 tab dengan nama aksesibel yang benar', cleaned.join(', '));

    const state = async () => teacher.evaluate(() =>
      [...document.querySelectorAll('[role=tab]')].map((el) => ({
        name: el.textContent.trim(), sel: el.getAttribute('aria-selected'), ti: el.tabIndex,
        id: el.id, controls: el.getAttribute('aria-controls'),
      })));
    let st = await state();
    const active = st.filter((x) => x.sel === 'true');
    if (active.length === 1 && active[0].name === 'Jurnal Mengajar') pass('Tepat satu tab aria-selected=true (Jurnal Mengajar dari ?tab=jurnal)');
    else fail('Tepat satu tab aria-selected=true', JSON.stringify(st));
    const tabbable = st.filter((x) => x.ti === 0);
    if (tabbable.length === 1 && tabbable[0].name === 'Jurnal Mengajar') pass('Roving tabindex: hanya tab aktif yang masuk urutan Tab');
    else fail('Roving tabindex: hanya tab aktif yang masuk urutan Tab', JSON.stringify(st));
    const ids = new Set(st.map((x) => x.id));
    if (ids.size === 6 && st.every((x) => x.id && x.controls)) pass('id tab unik dan aria-controls terisi');
    else fail('id tab unik dan aria-controls terisi', JSON.stringify(st));

    const panelOk = await teacher.evaluate(() => {
      const panels = [...document.querySelectorAll('[role=tabpanel]')];
      const sel = document.querySelector('[role=tab][aria-selected=true]');
      const p = document.getElementById(sel.getAttribute('aria-controls'));
      return { count: panels.length, linked: !!p && p.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === sel.id };
    });
    if (panelOk.count === 1 && panelOk.linked) pass('tabpanel tunggal terhubung dua arah (aria-controls <-> aria-labelledby)');
    else fail('tabpanel tunggal terhubung dua arah', JSON.stringify(panelOk));

    // Keyboard: fokus ke tab aktif, lalu panah.
    const focusedName = async () => teacher.evaluate(() => document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.textContent.trim() : `(${document.activeElement?.tagName})`);
    await teacher.getByRole('tab', { name: 'Jurnal Mengajar' }).focus();
    await teacher.keyboard.press('ArrowRight');
    const f1 = await focusedName();
    st = await state();
    if (f1 === 'Presensi' && st.find((x) => x.name === 'Jurnal Mengajar').sel === 'true') pass('ArrowRight memindah FOKUS ke Presensi tanpa mengganti tab aktif (aktivasi manual)');
    else fail('ArrowRight memindah fokus', `fokus=${f1}`);
    await teacher.keyboard.press('End');
    const f2 = await focusedName();
    await teacher.keyboard.press('ArrowRight');
    const f3 = await focusedName();
    await teacher.keyboard.press('ArrowLeft');
    const f4 = await focusedName();
    await teacher.keyboard.press('Home');
    const f5 = await focusedName();
    await teacher.keyboard.press('ArrowLeft');
    const f6 = await focusedName();
    if (f2 === 'Riwayat' && f3 === 'Jurnal Mengajar' && f4 === 'Riwayat' && f5 === 'Jurnal Mengajar' && f6 === 'Riwayat') pass('End/Home/ArrowRight/ArrowLeft bekerja dan membungkus (wrap)', [f2, f3, f4, f5, f6].join(' > '));
    else fail('End/Home/Arrow wrap', [f2, f3, f4, f5, f6].join(' > '));

    // Aktivasi dengan Enter, lalu Spasi.
    await teacher.keyboard.press('Home');
    await teacher.keyboard.press('ArrowRight');
    await teacher.keyboard.press('Enter');
    await teacher.waitForTimeout(1500);
    st = await state();
    const nowActive = st.find((x) => x.sel === 'true');
    const nowTab = st.filter((x) => x.ti === 0);
    if (nowActive?.name === 'Presensi' && nowTab.length === 1 && nowTab[0].name === 'Presensi') pass('Enter mengaktifkan Presensi; aria-selected dan tabindex ikut pindah');
    else fail('Enter mengaktifkan tab', JSON.stringify(st));
    await teacher.keyboard.press('ArrowRight');
    await teacher.keyboard.press('Space');
    await teacher.waitForTimeout(1500);
    st = await state();
    if (st.find((x) => x.sel === 'true')?.name === 'Nilai') pass('Spasi mengaktifkan Nilai');
    else fail('Spasi mengaktifkan tab', JSON.stringify(st));
    const panelNow = await teacher.evaluate(() => {
      const sel = document.querySelector('[role=tab][aria-selected=true]');
      const p = document.getElementById(sel.getAttribute('aria-controls'));
      return { ok: !!p && p.getAttribute('aria-labelledby') === sel.id, label: p?.getAttribute('aria-labelledby') };
    });
    if (panelNow.ok) pass('Setelah ganti tab, tabpanel baru terhubung ke tab aktif', panelNow.label);
    else fail('Setelah ganti tab, tabpanel terhubung', JSON.stringify(panelNow));

    // Klik mouse tetap bekerja dan ?tab= dipakai saat dimuat ulang.
    await teacher.getByRole('tab', { name: 'Riwayat' }).click();
    await teacher.waitForTimeout(1200);
    st = await state();
    if (st.find((x) => x.sel === 'true')?.name === 'Riwayat') pass('Klik mouse tetap memilih tab');
    else fail('Klik mouse memilih tab', JSON.stringify(st));
    await teacher.goto(`${BASE_URL}/attendance?class=${encodeURIComponent(CLASS_NAME)}&tab=tugas`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('tab', { name: 'Tugas', selected: true }).waitFor({ timeout: 30000 });
    pass('Query ?tab=tugas dihormati: tab Tugas terpilih saat dimuat');

    // Ukuran target sentuh tab >= 44px tinggi.
    const hts = await teacher.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((e) => e.getBoundingClientRect().height));
    if (hts.every((h) => h >= 44)) pass('Tinggi semua tab >= 44px', hts.map(Math.round).join(','));
    else fail('Tinggi semua tab >= 44px', hts.join(','));

    // Pemilih kelas ada? (tabpanel kosong tanpa kelas tidak boleh merusak ARIA)
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
