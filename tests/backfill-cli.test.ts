import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakePostgrest } from './helpers/fakePostgrest';

// CLI backfill dijalankan SUNGGUHAN sebagai proses (jiti) terhadap Firestore EMULATOR dan server
// Supabase PALSU lokal. Hanya jalan di bawah emulator (npm run test:rules). Tidak menyentuh Supabase nyata.
const emu = process.env.FIRESTORE_EMULATOR_HOST;
const suite = emu ? describe : describe.skip;

const ROOT = path.resolve(__dirname, '..');
const REF = 'abcdefghijklmnopqrst';
const SMADA = 'abdkrhmxfpcmgzsxzfyz';
const PROD = 'htutgpjcynbnyxwgorcb';
const KEY = 'svc-key-uji';

type Fake = ReturnType<typeof createFakePostgrest>;
let fake: Fake;
let server: Server;
let port = 0;
let hits: string[] = [];
let failPostNo = 0; // POST ke-N dibuat 500
let posts = 0;

function mkFake() {
  posts = 0;
  fake = createFakePostgrest({
    tokens: { [KEY]: 'ws1' },
    intercept: ({ method }) => {
      if (method === 'POST' && ++posts === failPostNo) return { status: 500, body: { message: 'boom' } };
    },
  });
}

async function seed(ids: string[], workspaceId = 'ws1') {
  const { initializeApp, getApps, getApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const app = getApps().find((a) => a.name === 'seed') ?? initializeApp({ projectId: 'demo-teacher-workspace' }, 'seed');
  void getApp;
  const db = getFirestore(app);
  const batch = () => db.batch();
  for (let i = 0; i < ids.length; i += 400) {
    const b = batch();
    ids.slice(i, i + 400).forEach((id) =>
      b.set(db.collection('session_skip_reasons').doc(id), {
        workspaceId, scheduleId: `sch-${id}`, className: '7A', date: '2026-10-09', reason: 'sakit', note: `n-${id}`,
        createdAt: Timestamp.fromMillis(1760000000000),
      }));
    await b.commit();
  }
}
async function clearFirestore() {
  await fetch(`http://${emu}/emulator/v1/projects/demo-teacher-workspace/databases/(default)/documents`, { method: 'DELETE' });
}

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/.bin/jiti'), 'scripts/migration/backfill-skip-reasons.ts', ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '', NODE_ENV: 'test', FIRESTORE_EMULATOR_HOST: emu!, GCLOUD_PROJECT: 'demo-teacher-workspace',
        SUPABASE_URL: `https://${REF}.supabase.co`, SUPABASE_SECRET_KEY: KEY, SUPABASE_ALLOWED_REFS: REF,
        BACKFILL_TEST_FETCH_MODULE: path.join(ROOT, 'tests/helpers/redirectFetch.mjs'),
        BACKFILL_TEST_REDIRECT: `http://127.0.0.1:${port}`, ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

suite('CLI backfill-skip-reasons (proses nyata, emulator + Supabase palsu)', () => {
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      hits.push(`${req.method} ${req.url}`);
      const r = (await fake.fetchImpl(`https://x.supabase.co${req.url}`, {
        method: req.method,
        headers: { Authorization: String(req.headers.authorization), Prefer: String(req.headers.prefer ?? ''), Range: String(req.headers.range ?? '') } as Record<string, string>,
        body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
      })) as unknown as { status: number; headers: Headers; text: () => Promise<string> };
      res.writeHead(r.status, { 'content-type': 'application/json', 'content-range': r.headers.get('content-range') ?? '' });
      res.end(await r.text());
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
  beforeEach(async () => { hits = []; failPostNo = 0; mkFake(); await clearFirestore(); });

  it('tanpa --workspace → exit 2, nol request', async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(hits).toEqual([]);
  });
  it.each([
    ['SmadaExam walau di allowlist', { SUPABASE_URL: `https://${SMADA}.supabase.co`, SUPABASE_ALLOWED_REFS: SMADA }],
    ['project di luar allowlist', { SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co' }],
    ['allowlist kosong', { SUPABASE_ALLOWED_REFS: '' }],
    ['produksi tanpa izin eksplisit', { SUPABASE_URL: `https://${PROD}.supabase.co`, SUPABASE_ALLOWED_REFS: PROD }],
  ])('target ditolak: %s → exit 2, nol request, --apply tidak berefek', async (_n, env) => {
    await seed(['a']);
    const r = await run(['--workspace', 'ws1', '--apply'], env);
    expect(r.code).toBe(2);
    expect(hits).toEqual([]);
    expect(fake.store.size).toBe(0);
  });
  it('dry-run: hanya GET, tidak ada mutasi, exit 1 karena data belum ada', async () => {
    await seed(['a', 'b', 'c']);
    const r = await run(['--workspace', 'ws1']);
    expect(r.code).toBe(1);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.startsWith('GET '))).toBe(true);
    expect(fake.store.size).toBe(0);
    expect(r.out).toContain('DRY-RUN');
  });
  it('--apply: ID & timestamp dipertahankan, exit 0; ulang tidak menggandakan; dry-run sesudahnya bersih', async () => {
    await seed(['a', 'b', 'c']);
    expect((await run(['--workspace', 'ws1', '--apply'])).code).toBe(0);
    expect([...fake.store.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(fake.store.get('a')).toMatchObject({
      workspace_id: 'ws1', class_name: '7A', reason: 'sakit', metadata: { scheduleId: 'sch-a', note: 'n-a' },
      created_at: new Date(1760000000000).toISOString(),
    });
    expect((await run(['--workspace', 'ws1', '--apply'])).code).toBe(0);
    expect(fake.store.size).toBe(3);
    hits = [];
    expect((await run(['--workspace', 'ws1'])).code).toBe(0);
    expect(hits.every((h) => h.startsWith('GET '))).toBe(true);
  });
  it('dokumen workspace lain di Firestore tidak ikut disalin', async () => {
    await seed(['a']);
    await seed(['zzz'], 'ws-lain');
    expect((await run(['--workspace', 'ws1', '--apply'])).code).toBe(0);
    expect([...fake.store.keys()]).toEqual(['a']);
  });
  it('baris berlebih di Supabase → exit 1 dan TIDAK dihapus', async () => {
    await seed(['a']);
    fake.store.set('ghost', { id: 'ghost', workspace_id: 'ws1', metadata: {} });
    const r = await run(['--workspace', 'ws1', '--apply']);
    expect(r.code).toBe(1);
    expect(fake.store.has('ghost')).toBe(true);
    expect(r.out).toContain('ghost');
  });
  it('kegagalan parsial (batch ke-2 500) → exit 1, laporan batch gagal; dijalankan ulang → exit 0', async () => {
    await seed(Array.from({ length: 205 }, (_, i) => `d${String(i).padStart(3, '0')}`));
    failPostNo = 2;
    const r = await run(['--workspace', 'ws1', '--apply']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('failedBatches');
    expect(r.out).toContain('boom');
    expect(fake.store.size).toBe(200);
    failPostNo = 0;
    expect((await run(['--workspace', 'ws1', '--apply'])).code).toBe(0);
    expect(fake.store.size).toBe(205);
  }, 60_000);
});
