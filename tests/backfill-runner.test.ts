import { describe, it, expect } from 'vitest';
import {
  ConfigError, PRODUCTION_REF, createSupabaseBackfillIO, parseBackfillConfig, runBackfill, type BackfillIO,
} from '../lib/migration/backfillRunner';

const STAGING = 'abcdefghijklmnopqrst'; // 20 char
const OTHER = 'zzzzzzzzzzzzzzzzzzzz';
const SMADA = 'abdkrhmxfpcmgzsxzfyz';
const env = (over: Record<string, string | undefined> = {}) => ({
  SUPABASE_URL: `https://${STAGING}.supabase.co`, SUPABASE_SECRET_KEY: 'k', SUPABASE_ALLOWED_REFS: STAGING, ...over,
});
const ARGS = ['--workspace', 'w1'];

type Doc = { id: string; data: Record<string, unknown> };
const d = (id: string, over: Record<string, unknown> = {}): Doc => ({
  id, data: { workspaceId: 'w1', scheduleId: `s-${id}`, className: '7A', date: '2026-10-09', reason: 'sakit', note: '', ...over },
});

// Supabase palsu in-memory dengan semantik upsert merge-duplicates.
function fakeIO(docs: Doc[], opts: { failBatch?: number } = {}) {
  const store = new Map<string, Record<string, unknown>>();
  const log = { upserts: 0, batches: 0 };
  const io: BackfillIO = {
    readFirestore: async () => docs,
    readSupabase: async () => [...store.values()],
    upsert: async (rows) => {
      if (opts.failBatch === log.batches++) throw new Error('boom');
      log.upserts++;
      for (const r of rows) store.set(String(r.id), { ...(store.get(String(r.id)) ?? {}), ...r });
    },
  };
  return { io, store, log };
}

describe('parseBackfillConfig', () => {
  it('--workspace wajib', () => {
    expect(() => parseBackfillConfig([], env())).toThrow(ConfigError);
    expect(() => parseBackfillConfig(['--workspace'], env())).toThrow(ConfigError);
    expect(() => parseBackfillConfig(['--workspace', '--apply'], env())).toThrow(ConfigError);
  });
  it('default dry-run; --apply eksplisit', () => {
    expect(parseBackfillConfig(ARGS, env()).apply).toBe(false);
    expect(parseBackfillConfig([...ARGS, '--apply'], env()).apply).toBe(true);
  });
  it('allowlist: menolak project di luar daftar, daftar kosong menolak semua', () => {
    expect(() => parseBackfillConfig(ARGS, env({ SUPABASE_URL: `https://${OTHER}.supabase.co` }))).toThrow(/ALLOWED_REFS/);
    expect(() => parseBackfillConfig(ARGS, env({ SUPABASE_ALLOWED_REFS: '' }))).toThrow(ConfigError);
    expect(() => parseBackfillConfig(ARGS, env({ SUPABASE_ALLOWED_REFS: undefined }))).toThrow(ConfigError);
    expect(() => parseBackfillConfig(ARGS, env({ SUPABASE_ALLOWED_REFS: `${OTHER}, ${STAGING}` }))).not.toThrow();
  });
  it('SmadaExam dilarang walau masuk allowlist', () => {
    expect(() =>
      parseBackfillConfig(ARGS, env({ SUPABASE_URL: `https://${SMADA}.supabase.co`, SUPABASE_ALLOWED_REFS: SMADA }))
    ).toThrow(/dilarang/);
  });
  it('produksi Workflow butuh persetujuan eksplisit tambahan', () => {
    const prod = env({ SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`, SUPABASE_ALLOWED_REFS: PRODUCTION_REF });
    expect(() => parseBackfillConfig(ARGS, prod)).toThrow(/produksi/);
    expect(() => parseBackfillConfig(ARGS, { ...prod, ALLOW_PRODUCTION_BACKFILL: 'yes' })).not.toThrow();
  });
  it('URL tak valid / bukan supabase.co / tanpa key ditolak; /rest/v1/ dinormalisasi', () => {
    expect(() => parseBackfillConfig(ARGS, env({ SUPABASE_URL: 'https://evil.example.com' }))).toThrow(ConfigError);
    expect(() => parseBackfillConfig(ARGS, env({ SUPABASE_URL: `http://${STAGING}.supabase.co` }))).toThrow(ConfigError);
    expect(() => parseBackfillConfig(ARGS, env({ SUPABASE_SECRET_KEY: '' }))).toThrow(ConfigError);
    expect(parseBackfillConfig(ARGS, env({ SUPABASE_URL: `https://${STAGING}.supabase.co/rest/v1/` })).url).toBe(`https://${STAGING}.supabase.co`);
  });
});

describe('runBackfill', () => {
  it('dry-run: nol upsert, store tetap kosong, exit 1 karena data belum ada', async () => {
    const f = fakeIO([d('a'), d('b')]);
    const r = await runBackfill({ workspaceId: 'w1', apply: false }, f.io);
    expect(f.log.upserts).toBe(0);
    expect(f.store.size).toBe(0);
    expect(r.exitCode).toBe(1);
    expect(r.report.missingInSupabase.sort()).toEqual(['a', 'b']);
  });
  it('dry-run di tingkat HTTP: hanya GET, tidak ada POST/PATCH/DELETE', async () => {
    const methods: string[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    }) as unknown as typeof fetch;
    const io = createSupabaseBackfillIO({ url: `https://${STAGING}.supabase.co`, key: 'k' }, { readFirestore: async () => [d('a')] }, fetchImpl);
    await runBackfill({ workspaceId: 'w1', apply: false }, io);
    expect(methods).toEqual(['GET']);
  });
  it('apply → bersih (exit 0); dijalankan ulang tetap bersih dan tidak menggandakan baris', async () => {
    const f = fakeIO([d('a'), d('b'), d('c')]);
    const r1 = await runBackfill({ workspaceId: 'w1', apply: true }, f.io);
    expect(r1.exitCode).toBe(0);
    expect(r1.upserted).toBe(3);
    const r2 = await runBackfill({ workspaceId: 'w1', apply: true }, f.io);
    expect(r2.exitCode).toBe(0);
    expect(f.store.size).toBe(3);
  });
  it('kegagalan parsial: batch lain tetap jalan, exit 1, laporan menyebut batch gagal', async () => {
    const f = fakeIO([d('a'), d('b'), d('c')], { failBatch: 1 });
    const r = await runBackfill({ workspaceId: 'w1', apply: true }, f.io, 1);
    expect(r.exitCode).toBe(1);
    expect(r.failedBatches).toEqual([{ index: 1, error: 'boom' }]);
    expect(r.upserted).toBe(2);
    expect(r.report.missingInSupabase).toEqual(['b']);
    // jalankan ulang tanpa gagal → pulih
    const f2 = { ...f, io: { ...f.io } };
    const r2 = await runBackfill({ workspaceId: 'w1', apply: true }, f2.io, 1);
    expect(r2.exitCode).toBe(0);
  });
  it('data berlebih di Supabase (bukan dari Firestore) → exit 1, tidak dihapus otomatis', async () => {
    const f = fakeIO([d('a')]);
    f.store.set('ghost', { id: 'ghost', workspace_id: 'w1' });
    const r = await runBackfill({ workspaceId: 'w1', apply: true }, f.io);
    expect(r.exitCode).toBe(1);
    expect(r.report.extraInSupabase).toEqual(['ghost']);
    expect(f.store.has('ghost')).toBe(true);
  });
  it('perbedaan field setelah apply (mis. baris lama beda) ditimpa lalu bersih', async () => {
    const f = fakeIO([d('a')]);
    f.store.set('a', { id: 'a', workspace_id: 'w1', reason: 'LAMA', metadata: {} });
    expect((await runBackfill({ workspaceId: 'w1', apply: false }, f.io)).report.mismatched[0].id).toBe('a');
    expect((await runBackfill({ workspaceId: 'w1', apply: true }, f.io)).exitCode).toBe(0);
  });
  it('dokumen tak valid / workspace salah dilewati, tidak ditulis, exit 1', async () => {
    const f = fakeIO([d('a'), { id: 'bad', data: { reason: 'x' } }, d('other', { workspaceId: 'w2' })]);
    const r = await runBackfill({ workspaceId: 'w1', apply: true }, f.io);
    expect(r.exitCode).toBe(1);
    expect(r.skippedInvalid.sort()).toEqual(['bad', 'other']);
    expect([...f.store.keys()]).toEqual(['a']);
  });
  it('ID duplikat dari sumber → ditulis sekali, exit 1', async () => {
    const f = fakeIO([d('a'), d('a')]);
    const r = await runBackfill({ workspaceId: 'w1', apply: true }, f.io);
    expect(f.store.size).toBe(1);
    expect(r.report.duplicateIds).toEqual(['a']);
    expect(r.exitCode).toBe(1);
  });
  it('kegagalan baca Supabase merambat sebagai error (CLI exit 1)', async () => {
    const f = fakeIO([d('a')]);
    f.io.readSupabase = async () => { throw new Error('Supabase 401'); };
    await expect(runBackfill({ workspaceId: 'w1', apply: false }, f.io)).rejects.toThrow('401');
  });
});
