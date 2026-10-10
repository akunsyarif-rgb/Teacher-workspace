/*
 * Bukti di BROWSER NYATA (Chromium) untuk lapisan offline Supabase: store IndexedDB + outbox bertahan setelah
 * muat ulang halaman, dan flush idempoten setelah "online" kembali. Server Supabase di sini PALSU (dalam-halaman);
 * yang diuji adalah IndexedDB, bukan Supabase. Jalankan: node tests/e2e/indexeddb-offline.mjs
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// TS -> JS ESM; import ke supabaseAdapter diganti kelas error minimal (hanya itu yang dipakai lapisan offline).
let js = ts.transpileModule(readFileSync(path.join(root, 'lib/adapters/offlineLayer.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
js = js.replace(/import \{[^}]*\} from '\.\/supabaseAdapter';/, `
export class SupabaseAdapterError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }`);

const server = http.createServer((req, res) => {
  if (req.url === '/offline.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(js); return; }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>idb</title><script type="module">import * as L from "/offline.js"; window.L = L; window.ready = true;</script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { (cond ? ok++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + extra}`); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
try {
  await page.goto(url);
  await page.waitForFunction(() => window.ready === true);

  // 1) KV store IndexedDB dasar
  const kv = await page.evaluate(async () => {
    const s = window.L.indexedDbStore('tw-test-kv');
    await s.set('a:1', { x: 1 }); await s.set('a:2', { x: 2 }); await s.set('b:1', 'z');
    const keys = await s.keys('a:'); const v = await s.get('a:2'); await s.del('a:1');
    return { keys, v, after: await s.keys('a:'), missing: await s.get('nope') };
  });
  check('IndexedDB: set/get/keys/del', JSON.stringify(kv.keys) === '["a:1","a:2"]' && kv.v.x === 2 && kv.after.length === 1 && kv.missing === undefined, JSON.stringify(kv));

  // 2) Offline: tulis masuk outbox (IndexedDB), baca memantulkan tulisan, server palsu TIDAK dipanggil
  const phase1 = await page.evaluate(async () => {
    window.serverCalls = 0;
    const base = {
      getDocuments: async () => { throw Object.assign(new Error('offline'), { kind: 'offline' }); },
      getDocument: async () => null, generateId: () => 'id-' + Math.random().toString(36).slice(2),
      addDocumentWithId: async () => { window.serverCalls++; }, setDocument: async () => { window.serverCalls++; },
      updateDocument: async () => { window.serverCalls++; }, deleteDocument: async () => { window.serverCalls++; }, batchWrite: async () => { window.serverCalls++; },
    };
    const a = window.L.withOfflineSupport(base, { store: window.L.indexedDbStore('tw-test-offline'), isOnline: () => false });
    const r = await a.addDocument('session_skip_reasons', { workspaceId: 'w', reason: 'sakit' });
    await a.updateDocument('session_skip_reasons', r.id, { reason: 'izin' });
    return { id: r.id, status: await a.getStatus(), serverCalls: window.serverCalls };
  });
  check('offline: 2 operasi masuk outbox, server tidak dipanggil', phase1.status.pending === 2 && phase1.serverCalls === 0, JSON.stringify(phase1));

  // 3) MUAT ULANG halaman → outbox harus tetap ada (bukti persistensi IndexedDB)
  await page.reload();
  await page.waitForFunction(() => window.ready === true);
  const persisted = await page.evaluate(async () => {
    const s = window.L.indexedDbStore('tw-test-offline');
    return (await s.keys('o:')).length;
  });
  check('setelah muat ulang halaman outbox masih 2 entri', persisted === 2, String(persisted));

  // 4) Online: flush mengirim dalam urutan, idempoten, outbox kosong, tahan flush ganda
  const phase2 = await page.evaluate(async () => {
    const calls = [];
    const base = {
      getDocuments: async () => [], getDocument: async () => null, generateId: () => 'x',
      addDocumentWithId: async () => true,
      setDocument: async (c, id, d) => { calls.push(['set', id, d.reason]); return { id }; },
      updateDocument: async (c, id, d) => { calls.push(['update', id, d.reason]); return { id }; },
      deleteDocument: async () => true, batchWrite: async () => true,
    };
    const a = window.L.withOfflineSupport(base, { store: window.L.indexedDbStore('tw-test-offline'), isOnline: () => true });
    await Promise.all([a.flush(), a.flush()]);
    await a.flush();
    return { calls, status: await a.getStatus() };
  });
  check('flush setelah reload: set lalu update, tepat sekali, outbox kosong',
    phase2.calls.length === 2 && phase2.calls[0][0] === 'set' && phase2.calls[1][0] === 'update' && phase2.status.pending === 0, JSON.stringify(phase2));

  // 5) Cache baca bertahan lintas muat ulang dan dipakai saat offline
  await page.evaluate(async () => {
    const online = { getDocuments: async () => [{ id: 'r1', workspaceId: 'w' }], getDocument: async () => ({ id: 'p1', n: 1 }), generateId: () => 'x', addDocumentWithId: async () => 0, setDocument: async () => 0, updateDocument: async () => 0, deleteDocument: async () => 0, batchWrite: async () => 0 };
    const a = window.L.withOfflineSupport(online, { store: window.L.indexedDbStore('tw-test-cache'), isOnline: () => true });
    await a.getDocuments('session_skip_reasons', [['workspaceId', '==', 'w']]);
    await a.getDocument('student_profiles', 'p1');
  });
  await page.reload();
  await page.waitForFunction(() => window.ready === true);
  const cached = await page.evaluate(async () => {
    const dead = { getDocuments: async () => { throw new window.L.SupabaseAdapterError('offline', 'x'); }, getDocument: async () => { throw new window.L.SupabaseAdapterError('offline', 'x'); }, generateId: () => 'x', addDocumentWithId: async () => 0, setDocument: async () => 0, updateDocument: async () => 0, deleteDocument: async () => 0, batchWrite: async () => 0 };
    const a = window.L.withOfflineSupport(dead, { store: window.L.indexedDbStore('tw-test-cache'), isOnline: () => false });
    return { rows: await a.getDocuments('session_skip_reasons', [['workspaceId', '==', 'w']]), profile: await a.getDocumentFromCache('student_profiles', 'p1') };
  });
  check('cache baca bertahan setelah muat ulang dan melayani saat offline', cached.rows.length === 1 && cached.profile?.id === 'p1', JSON.stringify(cached));
} finally {
  await browser.close();
  server.close();
}
console.log(`\nHASIL: ${ok}/${ok + fail} langkah berhasil`);
process.exit(fail ? 1 : 0);
