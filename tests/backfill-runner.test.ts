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
  it('respons tulis berbadan kosong (201/204, return=minimal) diterima sebagai sukses — regresi bug nyata', async () => {
    const store: unknown[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') { store.push(...JSON.parse(String(init.body))); return { ok: true, status: 201, text: async () => '' }; }
      if (String(_u).includes('/workspaces?')) return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'w1' }]) };
      return { ok: true, status: 200, text: async () => JSON.stringify(store) };
    }) as unknown as typeof fetch;
    const io = createSupabaseBackfillIO({ url: `https://${STAGING}.supabase.co`, key: 'k' }, { readFirestore: async () => [d('a')] }, fetchImpl);
    const r = await runBackfill({ workspaceId: 'w1', apply: true }, io);
    expect(r.failedBatches).toEqual([]);
    expect(r.exitCode).toBe(0);
  });
  it('dry-run di tingkat HTTP: hanya GET, tidak ada POST/PATCH/DELETE', async () => {
    const methods: string[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return { ok: true, status: 200, text: async () => '[]' };
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

import { STAGES, resolveCollections, runPlan, runReverse } from '../lib/migration/backfillRunner';

describe('tahap & urutan cutover', () => {
  it('urutan tetap: identity → teacher → school → students → submissions; all = gabungan berurutan', () => {
    expect(resolveCollections('identity')).toEqual(['workspaces', 'teacher_profiles']);
    expect(resolveCollections('students')).toEqual(['students', 'student_login_codes', 'student_profiles']);
    const all = resolveCollections('all');
    expect(all.indexOf('workspaces')).toBe(0);
    expect(all.indexOf('workspaces')).toBeLessThan(all.indexOf('teacher_profiles'));
    expect(all.indexOf('teacher_profiles')).toBeLessThan(all.indexOf('journals'));
    expect(all.indexOf('student_login_codes')).toBe(all.indexOf('students') + 1);
    expect(all.indexOf('submissions')).toBe(all.length - 1);
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(STAGES)).toEqual(['identity', 'teacher', 'school', 'students', 'submissions']);
  });
  it('parseBackfillConfig menerima nama tahap dan flag --reverse; koleksi tak dipetakan ditolak', () => {
    const c = parseBackfillConfig(['--workspace', 'w1', '--collection', 'identity', '--reverse'], env());
    expect(c.collections).toEqual(['workspaces', 'teacher_profiles']);
    expect(c.reverse).toBe(true);
    expect(() => parseBackfillConfig(['--workspace', 'w1', '--collection', 'payments'], env())).toThrow(ConfigError);
  });
});

describe('prasyarat workspace, laporan jumlah, runPlan', () => {
  const ws = { id: 'w1', data: { name: 'SMA', plan: 'school_annual', ownerUid: 'o', classLimit: 3, seatLimit: 5 } };
  const tp = { id: 'u1', data: { workspaceId: 'w1', role: 'OWNER', name: 'Budi' } };
  function multiIO() {
    const stores: Record<string, Map<string, Record<string, unknown>>> = {};
    const fsData: Record<string, { id: string; data: Record<string, unknown> }[]> = { workspaces: [ws], teacher_profiles: [tp] };
    const st = (c: string) => (stores[c] ??= new Map());
    const key = (c: string, r: Record<string, unknown>) => String(c === 'teacher_profiles' ? r.user_id : r.id);
    const io: BackfillIO = {
      readFirestore: async (_w, c) => fsData[c] ?? [],
      readSupabase: async (_w, c) => [...st(c).values()],
      upsert: async (rows, c) => { rows.forEach((r) => st(c).set(key(c, r), r)); },
      workspaceExists: async (w) => st('workspaces').has(w),
    };
    return { io, stores, st };
  }
  it('apply koleksi non-workspace SEBELUM workspaces → ditolak dengan prasyarat, tidak menulis, exit 1', async () => {
    const { io, st } = multiIO();
    const r = await runBackfill({ workspaceId: 'w1', apply: true, collection: 'teacher_profiles' }, io);
    expect(r.exitCode).toBe(1);
    expect(r.precondition).toContain("backfill 'workspaces'");
    expect(st('teacher_profiles').size).toBe(0);
  });
  it('dry-run tidak terkena prasyarat (hanya melaporkan); workspaces tidak butuh prasyarat', async () => {
    const { io } = multiIO();
    expect((await runBackfill({ workspaceId: 'w1', apply: false, collection: 'teacher_profiles' }, io)).precondition).toBeUndefined();
    expect((await runBackfill({ workspaceId: 'w1', apply: true, collection: 'workspaces' }, io)).exitCode).toBe(0);
  });
  it('runPlan identity apply: workspaces lalu teacher_profiles, laporan jumlah per koleksi, bersih; ulang tetap bersih', async () => {
    const { io, st } = multiIO();
    const p = await runPlan({ workspaceId: 'w1', apply: true }, io, STAGES.identity);
    expect(p.exitCode).toBe(0);
    expect(p.lines.map((l) => [l.collection, l.firestore, l.supabase, l.upserted, l.ok])).toEqual([['workspaces', 1, 1, 1, true], ['teacher_profiles', 1, 1, 1, true]]);
    expect(st('teacher_profiles').get('u1')).toMatchObject({ user_id: 'u1', workspace_id: 'w1', role: 'OWNER' });
    expect((await runPlan({ workspaceId: 'w1', apply: true }, io, STAGES.identity)).exitCode).toBe(0);
    expect(st('teacher_profiles').size).toBe(1);
  });
  it('runPlan apply berhenti di koleksi pertama yang tidak bersih (tidak lanjut di atas data rusak)', async () => {
    const { io, st } = multiIO();
    st('workspaces').set('ghost', { id: 'ghost' }); // baris berlebih → workspaces tidak bersih
    const p = await runPlan({ workspaceId: 'w1', apply: true }, io, STAGES.identity);
    expect(p.exitCode).toBe(1);
    expect(p.stoppedAt).toBe('workspaces');
    expect(p.lines).toHaveLength(1);
    expect(st('teacher_profiles').size).toBe(0);
  });
  it('runPlan dry-run melaporkan semua koleksi walau ada yang kotor', async () => {
    const { io } = multiIO();
    const p = await runPlan({ workspaceId: 'w1', apply: false }, io, STAGES.identity);
    expect(p.lines).toHaveLength(2);
    expect(p.lines.every((l) => l.missing === 1 && !l.ok)).toBe(true);
  });
  it('readSupabase berpaginasi (>1000 baris tidak terpotong)', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `j${String(i).padStart(4, '0')}`, workspace_id: 'w1', metadata: {} }));
    const ranges: string[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      const range = String((init?.headers as Record<string, string>)?.Range ?? '');
      ranges.push(range);
      const [a, b] = range.split('-').map(Number);
      return { ok: true, status: 200, text: async () => JSON.stringify(rows.slice(a, b + 1)) };
    }) as unknown as typeof fetch;
    const io = createSupabaseBackfillIO({ url: `https://${STAGING}.supabase.co`, key: 'k' }, { readFirestore: async () => [] }, fetchImpl);
    expect(await io.readSupabase('w1', 'journals')).toHaveLength(2500);
    expect(ranges).toEqual(['0-999', '1000-1999', '2000-2999']);
  });
});

describe('rollback data (runReverse): Supabase → Firestore, merge, tanpa hapus', () => {
  const fsDoc = (id: string, over: Record<string, unknown> = {}) => ({ id, data: { workspaceId: 'w1', scheduleId: `s-${id}`, className: '7A', date: '2026-10-09', reason: 'sakit', note: '', ...over } });
  function rIO(fsDocs: ReturnType<typeof fsDoc>[], supaRows: Record<string, unknown>[], failWrite = false) {
    const written: { id: string; data: Record<string, unknown> }[] = [];
    const io: BackfillIO = {
      readFirestore: async () => {
        const m = new Map<string, Record<string, unknown>>(fsDocs.map((d) => [d.id, d.data]));
        written.forEach((w) => m.set(w.id, { ...(m.get(w.id) ?? {}), ...w.data })); // set merge
        return [...m].map(([id, data]) => ({ id, data }));
      },
      readSupabase: async () => supaRows,
      upsert: async () => { throw new Error('reverse tidak boleh menulis ke Supabase'); },
      writeFirestore: async (_c, docs) => { if (failWrite) throw new Error('firestore down'); written.push(...docs); },
    };
    return { io, written };
  }
  const row = (id: string, over: Record<string, unknown> = {}) => ({ ...firestoreDocToRowForTest(id), ...over });
  function firestoreDocToRowForTest(id: string) {
    return { id, workspace_id: 'w1', class_name: '7A', date: '2026-10-09', reason: 'sakit', metadata: { scheduleId: `s-${id}`, note: '' }, created_at: 'x' };
  }
  const cfg = (apply: boolean) => ({ workspaceId: 'w1', apply, collection: 'session_skip_reasons' });

  it('dry-run: melaporkan selisih, tidak menulis', async () => {
    const { io, written } = rIO([fsDoc('a')], [row('a'), row('baru')]);
    const r = await runReverse(cfg(false), io);
    expect(r.toWrite).toEqual(['baru']);
    expect(r.exitCode).toBe(1);
    expect(written).toHaveLength(0);
  });
  it('apply: menyalin baris baru & yang berbeda ke Firestore; tidak menghapus apa pun; hasil bersih', async () => {
    const { io, written } = rIO([fsDoc('a'), fsDoc('b'), fsDoc('hanyaFs')], [row('a'), row('b', { reason: 'izin' }), row('baru')]);
    const r = await runReverse(cfg(true), io);
    expect(r.toWrite.sort()).toEqual(['b', 'baru']);
    expect(written.map((w) => w.id).sort()).toEqual(['b', 'baru']);
    expect(written.find((w) => w.id === 'b')?.data).toMatchObject({ reason: 'izin', workspaceId: 'w1', scheduleId: 's-b' });
    expect(Object.keys(written[0].data)).not.toContain('createdAt');
    expect(Object.keys(written[0].data)).not.toContain('id');
    expect(r.exitCode).toBe(0);
    expect(r.report.extraInSupabase).toEqual([]);
  });
  it('tanpa selisih → tidak menulis apa pun, exit 0; gagal tulis → exit 1 dengan error', async () => {
    const clean = rIO([fsDoc('a')], [row('a')]);
    expect(await runReverse(cfg(true), clean.io)).toMatchObject({ exitCode: 0, written: 0 });
    const bad = rIO([], [row('a')], true);
    const r = await runReverse(cfg(true), bad.io);
    expect(r.exitCode).toBe(1);
    expect(r.error).toContain('firestore down');
  });
});
