import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseAdapterError, buildFilterParams, createSupabaseAdapter, fromRow, toRow,
} from '../lib/adapters/supabaseAdapter';
import { isSupabaseCollection } from '../lib/config/dataBackend';
import { createFakePostgrest, type FakeOpts } from './helpers/fakePostgrest';

const C = 'session_skip_reasons';
const TOK_A = 'tok-A';
const TOK_B = 'tok-B';

function setup(over: Partial<FakeOpts> = {}, deps: Partial<Parameters<typeof createSupabaseAdapter>[0]> = {}) {
  const fake = createFakePostgrest({ tokens: { [TOK_A]: 'wsA', [TOK_B]: 'wsB' }, ...over });
  const tokens: (string | null)[] = [];
  const adapter = createSupabaseAdapter({
    url: 'https://x.supabase.co/rest/v1/',
    publishableKey: 'pk',
    getToken: async (force) => { tokens.push(force ? 'forced' : 'normal'); return deps.getToken ? deps.getToken(force) : TOK_A; },
    fetchImpl: fake.fetchImpl,
    sleep: async () => {},
    isOnline: () => true,
    ...deps,
    ...(deps.getToken ? { getToken: deps.getToken } : {}),
  });
  return { adapter, fake, tokens };
}
const skip = (over: Record<string, unknown> = {}) => ({ workspaceId: 'wsA', scheduleId: 's1', className: '7A', date: '2026-10-09', reason: 'sakit', note: 'x', ...over });
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as SupabaseAdapterError;

describe('dataBackend flag', () => {
  it('default mati', () => {
    expect(isSupabaseCollection(C, undefined)).toBe(false);
    expect(isSupabaseCollection(C, '')).toBe(false);
  });
});

describe('mapping', () => {
  it('field di luar kolom masuk metadata, timestamp server dibuang', () => {
    expect(toRow(C, { workspaceId: 'w', scheduleId: 's', note: 'x', date: '2026-10-09', createdAt: {} }))
      .toEqual({ workspace_id: 'w', date: '2026-10-09', metadata: { scheduleId: 's', note: 'x' } });
  });
  it('null kolom dihilangkan; metadata digabung; timestamp jadi createdAt/updatedAt', () => {
    expect(fromRow(C, { id: '1', workspace_id: 'w', class_name: null, metadata: { scheduleId: 's' }, created_at: 't', updated_at: 'u' }))
      .toEqual({ id: '1', workspaceId: 'w', scheduleId: 's', createdAt: 't', updatedAt: 'u' });
    expect(fromRow(C, { id: '1', workspace_id: 'w', metadata: null })).toEqual({ id: '1', workspaceId: 'w' });
  });
  it('filter: metadata, null, operator & nama field berbahaya, koleksi tak dipetakan', () => {
    expect(buildFilterParams(C, [['scheduleId', '==', 's']]).toString()).toContain('metadata-%3E%3EscheduleId=eq.s');
    expect(buildFilterParams(C, [['reason', '==', null]]).get('reason')).toBe('is.null');
    expect(() => buildFilterParams(C, [['date', '>', 'x']])).toThrow(SupabaseAdapterError);
    expect(() => buildFilterParams(C, [['a;drop table x', '==', 'x']])).toThrow(SupabaseAdapterError);
    expect(() => toRow('grades', {})).toThrow(SupabaseAdapterError);
  });
});

describe('baca', () => {
  it('filter workspace wajib (isolasi tenant)', async () => {
    const { adapter } = setup();
    expect((await err(adapter.getDocuments(C, [['date', '==', 'x']]))).kind).toBe('bad_request');
    expect((await err(adapter.getDocuments(C))).kind).toBe('bad_request');
    expect((await err(adapter.countDocuments(C, []))).kind).toBe('bad_request');
  });
  it('RLS: tenant lain tidak terbaca walau id & workspaceId ditebak', async () => {
    const { adapter } = setup({ rows: [{ id: 'b1', workspace_id: 'wsB', metadata: {} }] });
    expect(await adapter.getDocuments(C, [['workspaceId', '==', 'wsB']])).toEqual([]);
    expect(await adapter.getDocument(C, 'b1')).toBeNull();
  });
  it('paginasi: >pageSize baris tidak terpotong diam-diam', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, workspace_id: 'wsA', metadata: {} }));
    const { adapter, fake } = setup({ rows }, { pageSize: 10 });
    const got = await adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]);
    expect(got).toHaveLength(25);
    expect(new Set(got.map((g) => g.id)).size).toBe(25);
    expect(fake.log.filter((l) => l.method === 'GET')).toHaveLength(3);
  });
  it('countDocuments memakai count=exact', async () => {
    const rows = [1, 2, 3].map((i) => ({ id: `c${i}`, workspace_id: 'wsA', metadata: {} }));
    const { adapter } = setup({ rows });
    expect(await adapter.countDocuments(C, [['workspaceId', '==', 'wsA']])).toBe(3);
  });
  it('getDocumentFromCache selalu null; generateId unik', async () => {
    const { adapter } = setup();
    expect(await adapter.getDocumentFromCache(C, 'x')).toBeNull();
    expect(adapter.generateId(C)).not.toBe(adapter.generateId(C));
  });
});

describe('tulis', () => {
  it('addDocument: bentuk {id,...data} seperti Firestore, tersimpan di kolom + metadata', async () => {
    const { adapter, fake } = setup();
    const r = await adapter.addDocument(C, skip());
    expect(r).toMatchObject({ ...skip() });
    const row = fake.store.get(r.id as string)!;
    expect(row).toMatchObject({ workspace_id: 'wsA', class_name: '7A', reason: 'sakit', metadata: { scheduleId: 's1', note: 'x' } });
  });
  it('addDocument tanpa workspaceId ditolak; ke workspace lain ditolak RLS (bukan sukses diam-diam)', async () => {
    const { adapter, fake } = setup();
    expect((await err(adapter.addDocument(C, skip({ workspaceId: '' })))).kind).toBe('bad_request');
    expect((await err(adapter.addDocument(C, skip({ workspaceId: 'wsB' })))).kind).toBe('denied');
    expect(fake.store.size).toBe(0);
  });
  it('updateDocument: gabung field, pertahankan metadata lain, kembalikan {id,...data}, workspace_id tak dikirim', async () => {
    const { adapter, fake } = setup();
    const { id } = await adapter.addDocument(C, skip());
    fake.log.length = 0;
    const r = await adapter.updateDocument(C, id as string, { reason: 'izin' });
    expect(r).toEqual({ id, reason: 'izin' });
    expect(fake.store.get(id as string)).toMatchObject({ reason: 'izin', class_name: '7A', metadata: { scheduleId: 's1', note: 'x' } });
    const patch = fake.log.find((l) => l.method === 'PATCH')!;
    expect(patch.path).toContain('updated_at=eq.');
  });
  it('updateDocument: dokumen tak ada / milik tenant lain → error, bukan sukses', async () => {
    const { adapter } = setup({ rows: [{ id: 'b1', workspace_id: 'wsB', metadata: {} }] });
    expect((await err(adapter.updateDocument(C, 'nope', { reason: 'x' }))).kind).toBe('not_found');
    expect((await err(adapter.updateDocument(C, 'b1', { reason: 'x' }))).kind).toBe('not_found');
  });
  it('updateDocument: workspaceId immutable', async () => {
    const { adapter } = setup();
    const { id } = await adapter.addDocument(C, skip());
    expect((await err(adapter.updateDocument(C, id as string, { workspaceId: 'wsB' }))).kind).toBe('bad_request');
  });
  it('updateDocument: bentrok bersamaan terdeteksi (CAS) lalu diulang, tidak menimpa metadata lain', async () => {
    let injected = false;
    const { adapter, fake } = setup();
    const { id } = await adapter.addDocument(C, skip());
    // sisipkan update pihak lain tepat setelah baca pertama
    const orig = fake.fetchImpl;
    const wrapped = (async (u: string, init?: RequestInit) => {
      const res = await orig(u, init);
      if (!injected && (init?.method ?? 'GET') === 'GET' && u.includes(`id=eq.${id}`)) {
        injected = true;
        const row = fake.store.get(id as string)!;
        fake.store.set(id as string, { ...row, metadata: { ...(row.metadata as object), note: 'DARI-LAIN' }, updated_at: fake.stamp() });
      }
      return res;
    }) as typeof fetch;
    const a2 = createSupabaseAdapter({ url: 'https://x.supabase.co', publishableKey: 'pk', getToken: async () => TOK_A, fetchImpl: wrapped, sleep: async () => {}, isOnline: () => true });
    await a2.updateDocument(C, id as string, { reason: 'izin' });
    expect(fake.store.get(id as string)).toMatchObject({ reason: 'izin', metadata: { note: 'DARI-LAIN', scheduleId: 's1' } });
  });
  it('setDocument: buat bila belum ada, gabung bila ada', async () => {
    const { adapter, fake } = setup();
    await adapter.setDocument(C, 'fixed', skip());
    await adapter.setDocument(C, 'fixed', { reason: 'izin' });
    expect(fake.store.size).toBe(1);
    expect(fake.store.get('fixed')).toMatchObject({ reason: 'izin', metadata: { scheduleId: 's1' } });
  });
  it('deleteDocument: hapus; dokumen tak ada = sukses (seperti Firestore); ditolak RLS = error', async () => {
    const { adapter, fake } = setup({ rows: [{ id: 'b1', workspace_id: 'wsB', metadata: {} }] });
    const { id } = await adapter.addDocument(C, skip());
    expect(await adapter.deleteDocument(C, id as string)).toBe(true);
    expect(fake.store.has(id as string)).toBe(false);
    expect(await adapter.deleteDocument(C, 'tidak-ada')).toBe(true);
    // baris tenant lain tidak terlihat → diperlakukan tak ada (tidak bocor, tidak terhapus)
    expect(await adapter.deleteDocument(C, 'b1')).toBe(true);
    expect(fake.store.has('b1')).toBe(true);
  });
  it('batchWrite ditolak tegas (tidak ditiru tak-atomik)', async () => {
    const { adapter } = setup();
    expect((await err(adapter.batchWrite([]))).kind).toBe('bad_request');
  });
});

describe('kegagalan', () => {
  it('offline → error offline TANPA memanggil jaringan', async () => {
    const { adapter, fake } = setup({}, { isOnline: () => false });
    const e = await err(adapter.addDocument(C, skip()));
    expect(e.kind).toBe('offline');
    expect(fake.log).toHaveLength(0);
  });
  it('jaringan putus saat TULIS → error network, tidak diulang, tidak ada fallback', async () => {
    const { adapter, fake } = setup({ intercept: ({ method }) => (method === 'POST' ? 'network' : undefined) });
    const e = await err(adapter.addDocument(C, skip()));
    expect(e.kind).toBe('network');
    expect(fake.store.size).toBe(0);
  });
  it('GET diulang untuk 5xx lalu sukses; gagal terus → error server', async () => {
    let n = 0;
    const flaky = setup({ intercept: ({ method }) => (method === 'GET' && n++ < 2 ? { status: 503, body: { message: 'x' } } : undefined) });
    expect(await flaky.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']])).toEqual([]);
    const dead = setup({ intercept: () => ({ status: 500, body: { message: 'down' } }) });
    expect((await err(dead.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('server');
  });
  it('tulis 5xx TIDAK diulang', async () => {
    let posts = 0;
    const { adapter } = setup({ intercept: ({ method }) => { if (method === 'POST') { posts++; return { status: 502, body: {} }; } } });
    expect((await err(adapter.addDocument(C, skip()))).kind).toBe('server');
    expect(posts).toBe(1);
  });
  it('timeout → error timeout', async () => {
    const { adapter } = setup({ intercept: () => 'hang' }, { timeoutMs: 20, maxGetRetries: 0 });
    expect((await err(adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('timeout');
  });
  it('401 → refresh token sekali lalu sukses; tetap 401 → error auth', async () => {
    const getToken = vi.fn(async (force?: boolean) => (force ? TOK_A : 'kedaluwarsa'));
    const ok = setup({}, { getToken });
    expect(await ok.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']])).toEqual([]);
    expect(getToken).toHaveBeenCalledWith(true);
    const bad = setup({}, { getToken: async () => 'selalu-salah' });
    expect((await err(bad.adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('auth');
  });
  it('tanpa login (token null) → error auth, tanpa request', async () => {
    const { adapter, fake } = setup({}, { getToken: async () => null });
    expect((await err(adapter.getDocuments(C, [['workspaceId', '==', 'wsA']]))).kind).toBe('auth');
    expect(fake.log).toHaveLength(0);
  });
  it('penulisan 2xx tanpa baris dikembalikan tidak dianggap sukses', async () => {
    const { adapter } = setup({ intercept: ({ method }) => (method === 'POST' ? { status: 201, body: [] } : undefined) });
    expect((await err(adapter.addDocument(C, skip()))).kind).toBe('server');
  });
});
