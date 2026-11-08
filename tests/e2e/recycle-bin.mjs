/**
 * E2E Recycle Bin (halaman Akun > Sampah): hapus -> muncul di Sampah -> pulihkan.
 *
 * Mencakup: siswa (pemulihan lewat server), kelas utuh (hapus kelas OWNER/ADMIN),
 * dan celah batas paket yang ditutup (hapus satu-satunya siswa kelas, isi kuota
 * dengan kelas baru, lalu pulihkan -> harus ditolak).
 *
 * Juga: hapus PERMANEN dan "Kosongkan Sampah" khusus OWNER/ADMIN — tombolnya tidak tampil untuk
 * guru biasa dan API-nya menolak (403); data benar-benar hilang dari Firestore beserta turunannya.
 *
 * Jalankan: npm run test:e2e:recycle-bin
 */
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
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';

const BASE_URL = 'http://127.0.0.1:3100';
const TEACHER_EMAIL = `owner${Date.now()}@sekolah-uji.sch.id`;
const JOINER_EMAIL = `guru2${Date.now()}@sekolah-uji.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const CLASS_A = 'RB-A';
const CLASS_B = 'RB-B';
const CLASS_C = 'RB-C';
const CLASS_D = 'RB-D';
const ANI = 'Ani Pulih';
const BUDI = 'Budi Tetap';
const CITRA = 'Citra Kelas B';
const DINA = 'Dina Sendiri';
const GURU2_SISWA = 'Siswa Guru Dua';

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
    const file = `/tmp/e2e-sampah-gagal-${name.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
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


// Akses Firestore emulator TANPA rules — hanya untuk MEMERIKSA hasil (apakah dokumen benar-benar hilang)
// dan menyiapkan kuota kursi; bukan jalur yang dipakai aplikasi.
async function withAdminDb(fn) {
  const testEnv = await initializeTestEnvironment({ projectId: 'demo-teacher-workspace', firestore: { host: 'localhost', port: 8080 } });
  try {
    let out;
    await testEnv.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); });
    return out;
  } finally {
    await testEnv.cleanup();
  }
}
const docExists = (path) => withAdminDb(async (db) => (await getDoc(doc(db, ...path.split('/')))).exists());
const findByField = (col, field, value) =>
  withAdminDb(async (db) => (await getDocs(query(collection(db, col), where(field, '==', value)))).docs.map((d) => ({ id: d.id, ...d.data() })));
const bumpSeatLimit = (inviteCode, seats) =>
  withAdminDb(async (db) => {
    const bridge = await getDoc(doc(db, 'workspace_invites', inviteCode));
    await updateDoc(doc(db, 'workspaces', bridge.data().workspaceId), { seatLimit: seats });
  });

async function idTokenFor(email, password) {
  const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return (await res.json()).idToken;
}

async function run() {
  const server = await startAppServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const teacher = await (await browser.newContext()).newPage();
  const joiner = await (await browser.newContext()).newPage();

  const jsErrors = [];
  teacher.on('pageerror', (err) => jsErrors.push(err.message));
  joiner.on('pageerror', (err) => jsErrors.push(err.message));

  async function addStudent(name, nis, className, page = teacher) {
    await page.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Tambah Kelas Baru/i }).click();
    const form = page.locator('form').first();
    await form.locator('input').nth(0).fill(name, { timeout: 20000 });
    await form.locator('input').nth(1).fill(nis);
    await form.locator('input[placeholder*="TEKNIK"]').fill(className);
    await page.getByRole('button', { name: /Simpan Siswa/i }).click();
    await page.waitForTimeout(2500);
  }

  async function openClass(className, page = teacher) {
    await page.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await page.getByText(className, { exact: true }).first().click();
    await page.waitForTimeout(1200);
  }

  async function confirmDeletion(page = teacher) {
    await page.getByPlaceholder('Ketik HAPUS').fill('HAPUS');
    await page.getByRole('button', { name: /Ya, Hapus/i }).click();
    await page.waitForTimeout(2200);
  }

  async function binItems(page = teacher) {
    await page.goto(`${BASE_URL}/account/sampah`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('group', { name: /Saring jenis item/i }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const rows = await page.locator('[data-testid="bin-item"]').all();
    const out = [];
    for (const row of rows) out.push({ kind: await row.getAttribute('data-kind'), text: (await row.innerText()).replace(/\s+/g, ' ') });
    return out;
  }

  try {
    // ---------- Setup ----------
    // Workspace SEKOLAH (bukan individu): ada pemilik (OWNER) dan guru biasa (TEACHER) untuk uji izin.
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /^Sekolah$/i }).click();
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="SMA Negeri"], input[placeholder*="Kelas Pak"]', 'Sekolah Uji Sampah');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });

    await addStudent(ANI, '1001', CLASS_A);
    await addStudent(BUDI, '1002', CLASS_A);
    await addStudent(CITRA, '2001', CLASS_B);
    await addStudent(DINA, '3001', CLASS_C);
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(1500);
    const setupOk = (await Promise.all([CLASS_A, CLASS_B, CLASS_C].map((c) => teacher.getByText(c, { exact: true }).count()))).every((n) => n > 0);
    if (setupOk) pass('Setup: guru (OWNER) + 3 kelas (batas paket gratis) + siswa dibuat');
    else await failWithEvidence(teacher, 'Setup: guru (OWNER) + 3 kelas + siswa dibuat', 'kelas tidak lengkap');

    // ---------- 1. Menu & keadaan kosong ----------
    await teacher.goto(`${BASE_URL}/account`, { waitUntil: 'domcontentloaded' });
    const menuLink = teacher.getByRole('link', { name: /Sampah/i });
    // Halaman Akun memuat profil dulu (WorkspaceGuard); tunggu tautannya muncul.
    await menuLink.first().waitFor({ timeout: 20000 }).catch(() => {});
    if (await menuLink.count()) {
      await menuLink.first().click();
      await teacher.waitForURL(`${BASE_URL}/account/sampah`, { timeout: 15000 });
      pass('Menu Akun memuat tautan "Sampah" ke /account/sampah');
    } else {
      fail('Menu Akun memuat tautan "Sampah"', 'tautan tidak ditemukan');
    }
    let items = await binItems();
    const emptyShown = await teacher.getByText('Sampah kosong').count();
    if (items.length === 0 && emptyShown > 0) pass('Sampah awal kosong dan menampilkan keadaan kosong');
    else fail('Sampah awal kosong', `item=${items.length}, teks kosong=${emptyShown}`);

    // ---------- 2. Hapus siswa -> muncul di Sampah ----------
    await openClass(CLASS_A);
    await teacher.getByLabel(`Hapus Siswa ${ANI}`).click();
    const warning = await teacher.getByText(/Dipindahkan ke Sampah/i).count();
    await confirmDeletion();
    const aniGone = (await teacher.getByText(ANI, { exact: true }).count()) === 0;
    const budiStays = (await teacher.getByText(BUDI, { exact: true }).count()) > 0;
    if (aniGone && budiStays && warning > 0) pass('Hapus siswa: hilang dari kelas, siswa lain tetap, dialog menyebut Sampah');
    else await failWithEvidence(teacher, 'Hapus siswa', `aniGone=${aniGone} budiStays=${budiStays} dialogSampah=${warning > 0}`);

    items = await binItems();
    const aniItem = items.find((i) => i.kind === 'student' && i.text.includes(ANI));
    if (items.length === 1 && aniItem && /oleh Anda/.test(aniItem.text)) pass('Siswa terhapus muncul di Sampah (jenis Siswa, "oleh Anda")', aniItem.text.slice(0, 80));
    else await failWithEvidence(teacher, 'Siswa terhapus muncul di Sampah', JSON.stringify(items));

    // ---------- 3. Pulihkan siswa ----------
    await teacher.getByRole('button', { name: `Pulihkan ${ANI}` }).click();
    await teacher.getByText(`${ANI} dipulihkan.`).waitFor({ timeout: 20000 }).catch(() => {});
    const notice = await teacher.getByText(`${ANI} dipulihkan.`).count();
    items = await binItems();
    await openClass(CLASS_A);
    const aniBack = (await teacher.getByText(ANI, { exact: true }).count()) > 0;
    if (notice > 0 && items.length === 0 && aniBack) pass('Pulihkan siswa: pesan sukses, hilang dari Sampah, kembali ke kelasnya');
    else await failWithEvidence(teacher, 'Pulihkan siswa', `notice=${notice} binKosong=${items.length === 0} kembali=${aniBack}`);

    // ---------- 4. Hapus kelas utuh -> satu entri Kelas ----------
    await openClass(CLASS_B);
    await teacher.getByRole('button', { name: /Hapus Kelas Ini/i }).click();
    await confirmDeletion();
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(1500);
    const classBGone = (await teacher.getByText(CLASS_B, { exact: true }).count()) === 0;
    items = await binItems();
    const classItem = items.find((i) => i.kind === 'class' && i.text.includes(CLASS_B));
    const citraSeparate = items.some((i) => i.kind === 'student' && i.text.includes(CITRA));
    if (classBGone && classItem && /1 siswa/.test(classItem.text) && !citraSeparate) pass('Hapus kelas: kelas hilang; Sampah memuat SATU entri Kelas (siswanya tidak terdaftar terpisah)', classItem.text.slice(0, 80));
    else await failWithEvidence(teacher, 'Hapus kelas -> entri Kelas di Sampah', `classBGone=${classBGone} items=${JSON.stringify(items)}`);

    // Tangkapan layar (tinjauan visual manual): desktop dan lebar ponsel, saat Sampah memuat kelas.
    await teacher.screenshot({ path: '/tmp/e2e-sampah-desktop.png', fullPage: true });
    await teacher.setViewportSize({ width: 390, height: 800 });
    await teacher.waitForTimeout(400);
    await teacher.screenshot({ path: '/tmp/e2e-sampah-ponsel.png', fullPage: true });
    await teacher.setViewportSize({ width: 1280, height: 720 });

    // Saring per jenis
    await teacher.getByRole('button', { name: /^Siswa \(/ }).click();
    const studentFilterEmpty = await teacher.getByText(/Tidak ada siswa terhapus/i).count();
    await teacher.getByRole('button', { name: /^Kelas \(/ }).click();
    const classFilterRows = await teacher.locator('[data-testid="bin-item"]').count();
    if (studentFilterEmpty > 0 && classFilterRows === 1) pass('Saring per jenis: Siswa kosong, Kelas berisi 1 entri');
    else fail('Saring per jenis', `siswaKosong=${studentFilterEmpty} barisKelas=${classFilterRows}`);

    // ---------- 5. Pulihkan kelas ----------
    await teacher.getByRole('button', { name: `Pulihkan Kelas ${CLASS_B}` }).click();
    await teacher.getByText(`Kelas ${CLASS_B} dipulihkan.`).waitFor({ timeout: 20000 }).catch(() => {});
    await teacher.goto(`${BASE_URL}/classes`, { waitUntil: 'domcontentloaded' });
    await teacher.waitForTimeout(1500);
    const classBBack = (await teacher.getByText(CLASS_B, { exact: true }).count()) > 0;
    await openClass(CLASS_B);
    const citraBack = (await teacher.getByText(CITRA, { exact: true }).count()) > 0;
    if (classBBack && citraBack) pass('Pulihkan kelas: kelas dan siswanya kembali');
    else await failWithEvidence(teacher, 'Pulihkan kelas', `kelas=${classBBack} siswa=${citraBack}`);

    // ---------- 6. Celah batas paket tertutup ----------
    // Hapus satu-satunya siswa kelas C (kelas C hilang -> 2 aktif), isi kuota dengan kelas D (3 aktif),
    // lalu pulihkan siswa itu: akan menjadi kelas ke-4 -> harus ditolak server.
    await openClass(CLASS_C);
    await teacher.getByLabel(`Hapus Siswa ${DINA}`).click();
    await confirmDeletion();
    await addStudent('Eko Kelas D', '4001', CLASS_D);
    items = await binItems();
    const dinaItem = items.find((i) => i.kind === 'student' && i.text.includes(DINA));
    if (dinaItem) {
      await teacher.getByRole('button', { name: `Pulihkan ${DINA}` }).click();
      await teacher.waitForTimeout(3000);
      const limitMsg = await teacher.getByText(/dibatasi maksimal 3 kelas/i).count();
      const stillInBin = (await binItems()).some((i) => i.text.includes(DINA));
      if (limitMsg > 0 && stillInBin) pass('Batas paket: memulihkan siswa yang menghidupkan kelas ke-4 ditolak, siswa tetap di Sampah');
      else await failWithEvidence(teacher, 'Batas paket pada pemulihan', `pesanBatas=${limitMsg > 0} masihDiSampah=${stillInBin}`);
    } else {
      fail('Batas paket pada pemulihan', 'siswa Dina tidak ada di Sampah');
    }

    // ---------- 7. Guru biasa (TEACHER): tidak ada akses hapus permanen ----------
    await teacher.goto(`${BASE_URL}/account`, { waitUntil: 'domcontentloaded' });
    await teacher.getByTitle('Salin kode undangan').waitFor({ timeout: 20000 });
    const inviteCode = (await teacher.getByTitle('Salin kode undangan').locator('xpath=preceding-sibling::span[1]').innerText()).trim();
    await bumpSeatLimit(inviteCode, 5); // sekolah baru hanya 1 kursi sampai membeli (tidak tersedia di emulator)

    await joiner.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await joiner.getByRole('button', { name: /^Gabung$/i }).click();
    await joiner.fill('input[type="email"]', JOINER_EMAIL);
    await joiner.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await joiner.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await joiner.fill('input[placeholder*="AB3D9F"]', inviteCode);
    await joiner.click('button[type="submit"]');
    await joiner.waitForURL(`${BASE_URL}/`, { timeout: 30000 });

    await addStudent(GURU2_SISWA, '5001', CLASS_A, joiner); // kelas yang sudah ada (batas kelas tidak terpakai)
    await openClass(CLASS_A, joiner);
    await joiner.getByLabel(`Hapus Siswa ${GURU2_SISWA}`).click();
    await confirmDeletion(joiner);
    const guru2Rows = await binItems(joiner);
    const onlyOwn = guru2Rows.length === 1 && guru2Rows[0].text.includes(GURU2_SISWA); // sampah pemilik (Dina) tidak terlihat
    const joinerPage = await joiner.locator('body').innerText();
    const noPurgeUi = !/Hapus Permanen/i.test(joinerPage) && !/Kosongkan Sampah/i.test(joinerPage);
    const hasRestore = await joiner.getByRole('button', { name: `Pulihkan ${GURU2_SISWA}` }).count();
    if (onlyOwn && noPurgeUi && hasRestore > 0) pass('Guru biasa: hanya melihat sampah miliknya, bisa memulihkan, TANPA tombol Hapus Permanen / Kosongkan Sampah');
    else await failWithEvidence(joiner, 'Guru biasa: tampilan Sampah', `hanyaMilikSendiri=${onlyOwn} tanpaTombolPurge=${noPurgeUi} pulihkan=${hasRestore > 0} baris=${JSON.stringify(guru2Rows)}`);

    // API juga menolak (tidak hanya UI disembunyikan): panggilan langsung dengan token guru biasa.
    const guru2Doc = (await findByField('students', 'name', GURU2_SISWA))[0];
    const joinerToken = await idTokenFor(JOINER_EMAIL, TEACHER_PASSWORD);
    const direct = await fetch(`${BASE_URL}/api/trash/purge`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${joinerToken}` },
      body: JSON.stringify({ kind: 'student', id: guru2Doc.id }),
    });
    const directAll = await fetch(`${BASE_URL}/api/trash/purge`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${joinerToken}` }, body: JSON.stringify({ all: true }),
    });
    const stillThere = await docExists(`students/${guru2Doc.id}`);
    if (direct.status === 403 && directAll.status === 403 && stillThere) pass('API hapus permanen menolak guru biasa (403 untuk satu item dan untuk kosongkan Sampah); data utuh');
    else fail('API hapus permanen menolak guru biasa', `item=${direct.status} semua=${directAll.status} dataUtuh=${stillThere}`);

    // ---------- 8. OWNER: Hapus Permanen satu item (data fisik hilang beserta turunannya) ----------
    items = await binItems();
    const sawBoth = items.some((i) => i.text.includes(DINA)) && items.some((i) => i.text.includes(GURU2_SISWA));
    const purgeButtons = await teacher.getByRole('button', { name: /^Hapus permanen /i }).count();
    const emptyButton = await teacher.getByRole('button', { name: /Kosongkan Sampah/i }).count();
    if (sawBoth && purgeButtons === items.length && emptyButton === 1) pass('OWNER: melihat sampah semua guru dan tombol Hapus Permanen di tiap item + Kosongkan Sampah');
    else await failWithEvidence(teacher, 'OWNER: tampilan Sampah', `lihatKeduanya=${sawBoth} tombolPurge=${purgeButtons}/${items.length} kosongkan=${emptyButton}`);

    const dina = (await findByField('students', 'name', DINA))[0];
    const dinaCodeBefore = dina?.accessCode ? await docExists(`student_login_codes/${dina.accessCode}`) : false;

    await teacher.getByRole('button', { name: `Hapus permanen ${DINA}` }).click();
    const dialogTitle = await teacher.getByText('Hapus Permanen?', { exact: true }).count();
    const dialogScope = await teacher.getByText(/dihapus SELAMANYA/i).count();
    await confirmDeletion();
    const dinaNotice = await teacher.getByText(`${DINA} dihapus permanen.`).count();
    const dinaDocGone = !(await docExists(`students/${dina.id}`));
    const dinaCodeGone = dina?.accessCode ? !(await docExists(`student_login_codes/${dina.accessCode}`)) : false;
    items = await binItems();
    const dinaOutOfBin = !items.some((i) => i.text.includes(DINA));
    const guru2Untouched = await docExists(`students/${guru2Doc.id}`);
    if (dialogTitle > 0 && dialogScope > 0 && dinaNotice > 0 && dinaDocGone && dinaCodeBefore && dinaCodeGone && dinaOutOfBin && guru2Untouched) {
      pass('OWNER: Hapus Permanen — dialog menjelaskan cakupan; dokumen siswa dan kode aksesnya HILANG dari Firestore; item lain utuh');
    } else {
      await failWithEvidence(teacher, 'OWNER: Hapus Permanen satu item', `judul=${dialogTitle > 0} cakupan=${dialogScope > 0} notice=${dinaNotice > 0} docHilang=${dinaDocGone} kodeAda=${dinaCodeBefore} kodeHilang=${dinaCodeGone} keluarDariSampah=${dinaOutOfBin} itemLainUtuh=${guru2Untouched}`);
    }

    // Tangkapan layar tampilan OWNER (tombol Hapus Permanen + Kosongkan Sampah) untuk tinjauan visual.
    await teacher.setViewportSize({ width: 390, height: 800 });
    await teacher.waitForTimeout(400);
    await teacher.screenshot({ path: '/tmp/e2e-sampah-owner-ponsel.png', fullPage: true });
    await teacher.setViewportSize({ width: 1280, height: 720 });

    // ---------- 9. OWNER: Kosongkan Sampah ----------
    await teacher.getByRole('button', { name: /Kosongkan Sampah/i }).click();
    const emptyDialog = await teacher.getByText('Kosongkan Sampah?', { exact: true }).count();
    await confirmDeletion();
    items = await binItems();
    const binEmpty = items.length === 0 && (await teacher.getByText('Sampah kosong').count()) > 0;
    const guru2Gone = (await findByField('students', 'name', GURU2_SISWA)).length === 0;
    const activeKept = (await Promise.all([ANI, BUDI, CITRA].map((n) => findByField('students', 'name', n)))).every((r) => r.length === 1);
    if (emptyDialog > 0 && binEmpty && guru2Gone && activeKept) pass('OWNER: Kosongkan Sampah — Sampah kosong, item terhapus hilang dari Firestore, siswa aktif tetap ada');
    else await failWithEvidence(teacher, 'OWNER: Kosongkan Sampah', `dialog=${emptyDialog > 0} sampahKosong=${binEmpty} guru2Hilang=${guru2Gone} siswaAktifUtuh=${activeKept}`);

    // ---------- 10. Tanpa galat JavaScript ----------
    if (jsErrors.length === 0) pass('Tidak ada pageerror JavaScript selama alur Sampah');
    else fail('Tidak ada pageerror JavaScript', jsErrors.join(' | ').slice(0, 300));
  } catch (error) {
    await failWithEvidence(teacher, 'Alur uji berhenti karena error tak terduga', error.message);
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
