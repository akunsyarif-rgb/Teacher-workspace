/**
 * E2E browser Ulangan Harian: guru membuat paket + ulangan + menerbitkan, siswa mengerjakan (autosave, peringatan integritas,
 * submit), guru melihat rekap — memakai aplikasi (build produksi) di Chromium, Firebase Emulator (auth+firestore), Postgres LOKAL
 * dengan migrasi nyata, dan PostgREST resmi.
 *
 * "Gateway" kecil di port 4600 menggantikan gateway Supabase: menerima token Firebase (emulator) bercalm role=authenticated lalu
 * meneruskannya ke PostgREST sebagai JWT HS256 dengan sub yang sama (peran Third-Party Auth), dan memetakan secret key → service_role.
 * Ini BUKAN Supabase nyata; yang diuji: UI, controller, adapter, endpoint claim & sync-identity, RLS/RPC, di jalur yang sama dengan produksi.
 *
 * Jalankan (butuh Postgres lokal + biner PostgREST):
 *   POSTGREST_BIN=/path/postgrest RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npm run test:e2e:ulangan
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_URL = 'http://127.0.0.1:3100';
const GATEWAY_PORT = 4600;
const PGRST_PORT = 4601;
const JWT_SECRET = 'e2e-only-secret-e2e-only-secret-0123456789';
const SECRET_KEY = 'sb_secret_e2e_local';
const ADMIN_URL = process.env.RLS_TEST_ADMIN_URL;
const PGRST_BIN = process.env.POSTGREST_BIN;
if (!ADMIN_URL || !PGRST_BIN) {
  console.error('Butuh RLS_TEST_ADMIN_URL (Postgres lokal) dan POSTGREST_BIN (biner PostgREST).');
  process.exit(2);
}

const TEACHER_EMAIL = `guru${Date.now()}@contoh.sch.id`;
const TEACHER_PASSWORD = 'rahasia123';
const CLASS_NAME = 'XI-A';
const STUDENT_NAME = 'Budi Santoso';

const steps = [];
const pass = (name, detail = '') => { steps.push({ name, ok: true }); console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail) => { steps.push({ name, ok: false, detail }); console.log(`  ✗ ${name} — ${detail}`); };
const check = (cond, name, detail = '') => (cond ? pass(name, detail) : fail(name, detail || 'kondisi tidak terpenuhi'));

// ---------- Postgres + PostgREST + gateway ----------
const psql = (url, args, input, env) =>
  execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { input, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
const withDb = (url, db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

function createDatabase() {
  const db = `e2e_ulangan_${process.pid}_${Date.now()}`;
  const role = 'sb_owner_bypass';
  psql(ADMIN_URL, ['-c', `do $$ begin if not exists (select from pg_roles where rolname='${role}') then create role ${role} nosuperuser bypassrls login; end if; end $$`]);
  psql(ADMIN_URL, ['-c', `create database ${db} owner ${role}`]);
  const url = withDb(ADMIN_URL, db);
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => `supabase/migrations/${f}`);
  const files = ['supabase/test-support/000_auth_stub.sql', 'supabase/baseline/001_schema.sql', 'supabase/baseline/002_functions_triggers.sql', 'supabase/baseline/003_rls_policies_grants.sql', ...migrations];
  psql(url, ['-f', path.join(ROOT, files[0])]);
  psql(url, ['-c', `grant all on schema auth, private to ${role}`]);
  for (const f of files.slice(1)) psql(url, ['-f', path.join(ROOT, f)], undefined, { PGOPTIONS: `-c role=${role}` });
  psql(ADMIN_URL, ['-c', `do $$ begin if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'authpw'; end if; end $$`]);
  psql(url, ['-c', 'grant anon, authenticated, service_role to authenticator']);
  return { url, drop: () => psql(ADMIN_URL, ['-c', `drop database if exists ${db} with (force)`]) };
}

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function signJwt(claims) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
function firebaseClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}

function startGateway() {
  const gateway = http.createServer(async (req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, apikey, content-type, prefer, range, range-unit, x-client-info',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-expose-headers': 'content-range',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/rest/v1/')) { res.writeHead(404, cors); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
    for (const h of ['prefer', 'range', 'range-unit']) if (req.headers[h]) headers[h] = req.headers[h];
    if (bearer === SECRET_KEY) headers.authorization = `Bearer ${signJwt({ role: 'service_role' })}`;
    else if (bearer) {
      const c = firebaseClaims(bearer);
      // Peran Third-Party Auth: hanya token Firebase yang membawa role=authenticated dan belum kedaluwarsa yang diteruskan.
      if (c?.role === 'authenticated' && c.exp > Date.now() / 1000 && (c.user_id || c.sub)) headers.authorization = `Bearer ${signJwt({ sub: c.user_id || c.sub, role: 'authenticated' })}`;
      else { res.writeHead(401, { ...cors, 'content-type': 'application/json' }); return res.end('{"message":"JWT invalid"}'); }
    }
    const upstream = await fetch(`http://127.0.0.1:${PGRST_PORT}${url.pathname.replace('/rest/v1', '')}${url.search}`, {
      method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const text = await upstream.text();
    const out = { ...cors, 'content-type': upstream.headers.get('content-type') || 'application/json' };
    if (upstream.headers.get('content-range')) out['content-range'] = upstream.headers.get('content-range');
    res.writeHead(upstream.status, out);
    res.end(text);
  });
  return new Promise((resolve) => gateway.listen(GATEWAY_PORT, '127.0.0.1', () => resolve(gateway)));
}

async function startPostgrest(dbUrl) {
  const u = new URL(dbUrl); u.username = 'authenticator'; u.password = 'authpw';
  const proc = spawn(PGRST_BIN, [], {
    env: { PATH: process.env.PATH, PGRST_DB_URI: u.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(PGRST_PORT), PGRST_LOG_LEVEL: 'warn' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PGRST_PORT}/`)).status < 500) return proc; } catch { /* belum siap */ }
    await sleep(100);
  }
  throw new Error('PostgREST tidak siap');
}

// ---------- Aplikasi ----------
const APP_ENV = {
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-teacher-workspace.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-teacher-workspace',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-teacher-workspace.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:demo',
  // Ulangan Harian → "Supabase" lokal (gateway) — flag koleksi migrasi TETAP kosong (semua data lain tetap di Firestore).
  NEXT_PUBLIC_ULANGAN_ENABLED: 'yes',
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e',
  SUPABASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
  SUPABASE_SECRET_KEY: SECRET_KEY,
  ENABLE_SUPABASE_CLAIM: 'yes',
  ENABLE_ULANGAN_IDENTITY_SYNC: 'yes',
};

const isPortTaken = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.end(); resolve(true); });
  s.on('error', () => resolve(false));
});

async function startApp() {
  if (await isPortTaken(3100)) throw new Error('Port 3100 sudah dipakai proses lain; hentikan dulu agar server yang salah tidak teruji.');
  if (process.env.E2E_SKIP_BUILD !== 'true') {
    console.log('→ Build aplikasi (mode emulator + Ulangan)...');
    await new Promise((resolve, reject) => {
      const b = spawn('npx', ['next', 'build'], { env: { ...process.env, ...APP_ENV }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      b.stderr.on('data', (c) => (err += c));
      b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next build gagal:\n${err.slice(-2000)}`))));
    });
  }
  const server = spawn('npx', ['next', 'start', '--port', '3100', '--hostname', '127.0.0.1'], { env: { ...process.env, ...APP_ENV }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  server.stdout.on('data', (c) => process.env.E2E_VERBOSE && process.stdout.write(`[next] ${c}`));
  server.stderr.on('data', (c) => process.env.E2E_VERBOSE && process.stderr.write(`[next] ${c}`));
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE_URL); if (r.ok || r.status === 404) return server; } catch { /* belum siap */ }
    await sleep(1000);
  }
  throw new Error('Next.js tidak kunjung siap dalam 90 detik.');
}
const stopServer = (server) => { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGKILL'); } catch { /* sudah mati */ } } };

const localDateTime = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function run() {
  const db = createDatabase();
  const gateway = await startGateway();
  const pgrst = await startPostgrest(db.url);
  const q = (sql) => psql(db.url, ['-c', sql]).trim();
  const server = await startApp();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const teacher = await (await browser.newContext()).newPage();
  const student = await (await browser.newContext()).newPage();
  const pageErrors = [];
  for (const [label, page] of [['guru', teacher], ['siswa', student]]) page.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message}`));

  let accessCode = null;
  try {
    // ---------- 1. Guru: daftar, kelas + siswa, kode akses ----------
    console.log('\n→ Persiapan (guru, kelas, siswa)');
    await teacher.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' });
    await teacher.fill('input[type="email"]', TEACHER_EMAIL);
    await teacher.fill('input[placeholder="Minimal 6 karakter"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder="Ulangi kata sandi"]', TEACHER_PASSWORD);
    await teacher.fill('input[placeholder*="Kelas Pak"]', 'Workspace Uji');
    await teacher.click('button[type="submit"]');
    await teacher.waitForURL(`${BASE_URL}/`, { timeout: 30000 });
    pass('Guru mendaftar dan workspace terbuat');

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
    if (await codeButton.count()) { accessCode = (await codeButton.innerText()).trim().split('\n')[0].trim(); pass('Kode akses siswa tersedia', accessCode); }
    else fail('Kode akses siswa tersedia', 'tombol kode tidak ditemukan');

    // ---------- 2. Guru: paket soal ----------
    console.log('\n→ Guru membuat dan menerbitkan ulangan');
    await teacher.goto(`${BASE_URL}/ulangan`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: 'Paket Soal', exact: true }).click({ timeout: 30000 });
    await teacher.getByRole('button', { name: /\+ Paket Soal Baru/ }).click();
    await teacher.fill('input[placeholder*="Judul paket"]', 'UH Bab 1');
    await teacher.fill('input[placeholder="Mata pelajaran"]', 'IPA');
    const bodies = teacher.locator('textarea[placeholder="Teks soal"]');
    await bodies.nth(0).fill('Soal satu?');
    for (const l of ['A', 'B', 'C', 'D']) await teacher.locator(`input[placeholder="Pilihan ${l}"]`).nth(0).fill(`${l}1`);
    await teacher.locator('input[aria-label="Kunci soal 1 pilihan 2"]').check(); // kunci: B1
    await teacher.getByRole('button', { name: /Tambah soal/ }).click();
    await bodies.nth(1).fill('Soal dua?');
    for (const l of ['A', 'B', 'C', 'D']) await teacher.locator(`input[placeholder="Pilihan ${l}"]`).nth(1).fill(`${l}2`);
    await teacher.locator('input[aria-label="Kunci soal 2 pilihan 3"]').check(); // kunci: C2
    await teacher.getByRole('button', { name: 'Simpan Final' }).click();
    await teacher.getByText('UH Bab 1').first().waitFor({ timeout: 20000 });
    check(q("select count(*) from public.ulh_packages where status = 'final'") === '1', 'Paket soal final tersimpan di database (Supabase lokal)');
    check(q('select count(*) from public.ulh_members') >= '1', 'Identitas guru terproyeksi oleh /api/ulangan/sync-identity (dari Firestore)');
    check(q("select count(*) from public.ulh_roster where class_name = '" + CLASS_NAME + "'") === '1', 'Roster siswa terproyeksi', CLASS_NAME);

    // ---------- 3. Guru: ulangan ----------
    await teacher.getByRole('button', { name: 'Ulangan', exact: true }).click();
    await teacher.getByRole('button', { name: /\+ Ulangan Baru/ }).click();
    await teacher.fill('input[placeholder="Judul ulangan"]', 'UH 1 IPA');
    const now = new Date();
    await teacher.locator('input[type="datetime-local"]').nth(0).fill(localDateTime(new Date(now.getTime() - 3600_000)));
    await teacher.locator('input[type="datetime-local"]').nth(1).fill(localDateTime(new Date(now.getTime() + 2 * 3600_000)));
    await teacher.getByText(CLASS_NAME, { exact: true }).last().click();
    await teacher.getByLabel(/Tampilkan nilai ke siswa/).check();
    await teacher.getByRole('button', { name: 'Terbitkan' }).click();
    await teacher.getByText('UH 1 IPA').first().waitFor({ timeout: 20000 });
    check(q("select status from public.ulh_exams") === 'published', 'Ulangan diterbitkan', q('select title || \' / \' || duration_minutes || \' mnt\' from public.ulh_exams'));

    // ---------- 4. Siswa mengerjakan ----------
    console.log('\n→ Siswa mengerjakan');
    if (!accessCode) throw new Error('kode akses tidak ada');
    await student.goto(`${BASE_URL}/student/login`, { waitUntil: 'domcontentloaded' });
    await student.fill('input[placeholder*="CONTOH"]', accessCode);
    await student.getByRole('button', { name: /Masuk/i }).click();
    await student.waitForURL(`${BASE_URL}/student`, { timeout: 25000 });
    await student.goto(`${BASE_URL}/student/ulangan`, { waitUntil: 'domcontentloaded' });
    await student.getByText('UH 1 IPA').waitFor({ timeout: 30000 });
    pass('Siswa melihat ulangan kelasnya (identitas siswa terproyeksi saat dibutuhkan)');
    await student.getByRole('button', { name: /Mulai Ulangan/ }).click();
    await student.waitForURL(/\/student\/ulangan\/[0-9a-f-]{36}/, { timeout: 20000 });
    await student.getByText('Soal satu?').waitFor({ timeout: 20000 });
    pass('Siswa memulai ulangan; soal tampil', student.url().split('/').pop());
    const timerText = await student.locator('p.tabular-nums').first().innerText();
    check(/^\d\d:\d\d$/.test(timerText.trim()), 'Timer server tampil', timerText.trim());
    const html = await student.content();
    check(!/correct|kunci/i.test(html.replace(/Kunci soal/g, '')), 'Halaman ujian siswa tidak memuat petunjuk kunci jawaban');

    // Peringatan integritas: tinggalkan halaman > 3 detik
    await student.evaluate(() => window.dispatchEvent(new Event('blur')));
    await student.waitForTimeout(3600);
    await student.evaluate(() => window.dispatchEvent(new Event('focus')));
    await student.getByText(/Peringatan 1/).waitFor({ timeout: 15000 });
    check(q("select count(*) from public.ulh_integrity_events where warning_level = 1") === '1', 'Peringatan 1 tercatat server setelah >3 detik di luar halaman');
    await student.getByRole('button', { name: 'Mengerti' }).click();
    // Di bawah 3 detik: tidak dicatat
    await student.evaluate(() => window.dispatchEvent(new Event('blur')));
    await student.waitForTimeout(1000);
    await student.evaluate(() => window.dispatchEvent(new Event('focus')));
    await student.waitForTimeout(1500);
    check(q('select count(*) from public.ulh_integrity_events') === '1', 'Keluar halaman <3 detik tidak dicatat');

    // Autosave: jawab Q1 benar, Q2 salah
    await student.getByRole('button', { name: 'B1', exact: true }).click();
    await student.getByRole('button', { name: 'A2', exact: true }).click();
    await student.waitForTimeout(2500);
    check(q('select count(*) from public.ulh_answers') === '2', 'Autosave: 2 jawaban tersimpan di server sebelum submit');
    await student.reload({ waitUntil: 'domcontentloaded' });
    await student.getByText('Soal satu?').waitFor({ timeout: 20000 });
    const restored = (await student.getByRole('button', { name: 'B1', exact: true }).getAttribute('aria-pressed')) === 'true'
      && (await student.getByRole('button', { name: 'A2', exact: true }).getAttribute('aria-pressed')) === 'true';
    check(restored, 'Setelah reload, jawaban dipulihkan dari server');

    // Ganti jawaban Q2 ke yang benar lalu kembalikan ke salah (autosave memakai jawaban terakhir)
    await student.getByRole('button', { name: 'C2', exact: true }).click();
    await student.getByRole('button', { name: 'A2', exact: true }).click();
    await student.waitForTimeout(2000);

    // Submit
    await student.getByRole('button', { name: /Selesai & Kumpulkan/ }).click();
    await student.getByRole('button', { name: /Kumpulkan \(2\/2 terjawab\)/ }).click();
    await student.getByText(/Jawabanmu sudah dikumpulkan/).waitFor({ timeout: 20000 });
    await student.getByText(/Nilai:/).waitFor({ timeout: 10000 });
    const resultText = (await student.getByText(/Nilai:/).innerText()).replace(/\s+/g, ' ');
    check(/Nilai: 50/.test(resultText), 'Submit: skor dihitung server, siswa melihat nilai', resultText);
    check(q("select status || '|' || score || '|' || correct_count from public.ulh_attempts") === 'submitted|50.00|1', 'Database: attempt submitted, skor 50, 1 benar');

    // Kembali ke daftar → ulangan selesai, tidak bisa mulai lagi
    await student.goto(`${BASE_URL}/student/ulangan`, { waitUntil: 'domcontentloaded' });
    await student.getByText(/Nilai: 50/).waitFor({ timeout: 20000 });
    check((await student.getByRole('button', { name: /Mulai Ulangan|Lanjutkan/ }).count()) === 0, 'Ulangan yang sudah dikumpulkan tidak dapat diulang');

    // ---------- 5. Guru: rekap ----------
    console.log('\n→ Guru melihat rekap');
    await teacher.goto(`${BASE_URL}/ulangan`, { waitUntil: 'domcontentloaded' });
    await teacher.getByRole('button', { name: /Pantau & Hasil/ }).first().click({ timeout: 30000 });
    await teacher.getByText(STUDENT_NAME).first().waitFor({ timeout: 20000 });
    const rowText = (await teacher.locator('tr', { hasText: STUDENT_NAME }).first().innerText()).replace(/\s+/g, ' ');
    check(/Selesai/.test(rowText) && /50/.test(rowText) && /2\/2/.test(rowText), 'Rekap guru: Selesai, terjawab 2/2, nilai 50', rowText);
    check(/1× keluar halaman/.test(rowText), 'Rekap guru menampilkan sinyal integritas (indikasi, bukan sanksi)', rowText);
    check(q("select status from public.ulh_attempts") === 'submitted', 'Tidak ada sanksi otomatis: status tetap submitted normal');
    const audit = q("select string_agg(action, ',' order by id) from public.ulh_audit_log");
    check(audit === 'package.create,exam.create,exam.publish', 'Audit guru tercatat', audit);
    check(pageErrors.length === 0, 'Tidak ada pageerror JavaScript di browser', pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('Alur e2e', e instanceof Error ? e.message.split('\n')[0] : String(e));
    for (const [label, page] of [['guru', teacher], ['siswa', student]]) {
      try { await page.screenshot({ path: `/tmp/e2e-ulangan-${label}.png`, fullPage: true }); console.log(`  (layar ${label}: /tmp/e2e-ulangan-${label}.png)`); } catch { /* halaman tertutup */ }
    }
  } finally {
    await browser.close();
    stopServer(server);
    pgrst.kill();
    gateway.close();
    try { db.drop(); } catch { /* sudah hilang */ }
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} langkah lolos`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
