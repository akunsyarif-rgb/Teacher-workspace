import { describe, expect, it } from 'vitest';
import { createSupabaseAdapter } from '../lib/adapters/supabaseAdapter';
import { memoryStore, withOfflineSupport } from '../lib/adapters/offlineLayer';
import { createFakePostgrest, type FakeOpts } from './helpers/fakePostgrest';

const C = 'session_skip_reasons';
const F: [string, string, unknown][] = [['workspaceId', '==', 'wsA']];
const doc = (over: Record<string, unknown> = {}) => ({ workspaceId: 'wsA', scheduleId: 's1', className: '7A', date: '2026-10-09', reason: 'sakit', note: '', ...over });

function setup(over: Partial<FakeOpts> = {}) {
  const net = { online: true, dropWrites: false, dropAll: false };
  const fake = createFakePostgrest({
    tokens: { t: 'wsA' },
    intercept: (req) => {
      if (net.dropAll) return 'network';
      if (net.dropWrites && req.method !== 'GET') return 'network';
      return over.intercept?.(req);
    },
    ...over,
  });
  const base = createSupabaseAdapter({
    url: 'https://x.supabase.co', publishableKey: 'pk', getToken: async () => 't', fetchImpl: fake.fetchImpl,
    sleep: async () => {}, isOnline: () => net.online, maxGetRetries: 0,
  });
  const store = memoryStore();
  const adapter = withOfflineSupport(base, { store, isOnline: () => net.online });
  return { adapter, base, fake, net, store };
}

describe('baca: cache', () => {
  it('online → cache; offline → cache dikembalikan; belum pernah dimuat → error jujur', async () => {
    const { adapter, net } = setup({ rows: [{ id: 'r1', workspace_id: 'wsA', reason: 'rapat', metadata: {} }] });
    expect(await adapter.getDocuments(C, F)).toHaveLength(1);
    net.online = false;
    expect(await adapter.getDocuments(C, F)).toHaveLength(1);
    await expect(adapter.getDocuments(C, [['workspaceId', '==', 'wsA'], ['date', '==', 'x']])).rejects.toMatchObject({ kind: 'offline' });
  });
  it('jaringan putus di tengah baca juga jatuh ke cache', async () => {
    const { adapter, net } = setup({ rows: [{ id: 'r1', workspace_id: 'wsA', metadata: {} }] });
    await adapter.getDocuments(C, F);
    net.dropAll = true;
    expect(await adapter.getDocuments(C, F)).toHaveLength(1);
  });
  it('error bukan-jaringan (denied/auth) TIDAK disamarkan dengan cache', async () => {
    const { adapter } = setup({ rows: [{ id: 'r1', workspace_id: 'wsA', metadata: {} }] });
    await adapter.getDocuments(C, F);
    const bad = withOfflineSupport(
      createSupabaseAdapter({ url: 'https://x.supabase.co', publishableKey: 'pk', getToken: async () => 'salah', fetchImpl: setup().fake.fetchImpl, sleep: async () => {}, isOnline: () => true }),
      { store: memoryStore(), isOnline: () => true });
    await expect(bad.getDocuments(C, F)).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('tulis offline → outbox → flush', () => {
  it('add offline: terlihat langsung (read-your-writes), terkirim sekali saat online, id dipertahankan', async () => {
    const { adapter, fake, net } = setup();
    net.online = false;
    const r = await adapter.addDocument(C, doc());
    expect(await adapter.getStatus()).toEqual({ pending: 1, failed: 0 });
    expect((await adapter.getDocuments(C, F).catch(() => []))).toEqual([]); // belum pernah dimuat & offline → error jujur (di-catch)
    net.online = true;
    const shown = await adapter.getDocuments(C, F); // flush otomatis sebelum baca
    expect(shown.map((x) => x.id)).toEqual([r.id]);
    expect(fake.store.size).toBe(1);
    expect(fake.store.has(r.id as string)).toBe(true);
    await adapter.flush(); await adapter.flush();
    expect(fake.store.size).toBe(1);
    expect(await adapter.getStatus()).toEqual({ pending: 0, failed: 0 });
  });
  it('overlay terlihat saat masih offline setelah cache dimuat', async () => {
    const { adapter, net } = setup();
    const FI: [string, string, unknown][] = [['workspaceId', '==', 'wsA'], ['reason', '==', 'izin']];
    await adapter.getDocuments(C, F);
    await adapter.getDocuments(C, FI);
    net.online = false;
    const r = await adapter.addDocument(C, doc());
    expect((await adapter.getDocuments(C, F)).map((x) => x.id)).toEqual([r.id]);
    expect(await adapter.getDocuments(C, FI)).toEqual([]);
  });
  it('POST sampai server tapi respons hilang (jaringan putus) → diantrekan → replay idempoten, tidak ganda', async () => {
    const { adapter, fake, net } = setup();
    // jaringan putus SETELAH server menyimpan: simulasikan dengan menyimpan lalu melempar
    const orig = fake.fetchImpl;
    let lost = true;
    const base = createSupabaseAdapter({
      url: 'https://x.supabase.co', publishableKey: 'pk', getToken: async () => 't', sleep: async () => {}, isOnline: () => net.online, maxGetRetries: 0,
      fetchImpl: (async (u: string, init?: RequestInit) => {
        const res = await orig(u, init);
        if (lost && init?.method === 'POST') { lost = false; throw new TypeError('fetch failed'); }
        return res;
      }) as typeof fetch,
    });
    const a = withOfflineSupport(base, { store: memoryStore(), isOnline: () => net.online });
    const r = await a.addDocument(C, doc());
    expect(fake.store.size).toBe(1); // sudah ada di server
    expect(await a.getStatus()).toEqual({ pending: 1, failed: 0 });
    await a.flush();
    expect(fake.store.size).toBe(1);
    expect(fake.store.has(r.id as string)).toBe(true);
    expect(await a.getStatus()).toEqual({ pending: 0, failed: 0 });
    void adapter;
  });
  it('urutan: add → update → delete offline berakhir kosong; add → update berakhir dengan nilai terakhir', async () => {
    const { adapter, fake, net } = setup();
    net.online = false;
    const a = await adapter.addDocument(C, doc());
    await adapter.updateDocument(C, a.id as string, { reason: 'izin' });
    const b = await adapter.addDocument(C, doc({ scheduleId: 's2' }));
    await adapter.updateDocument(C, b.id as string, { reason: 'dinas' });
    await adapter.deleteDocument(C, a.id as string);
    net.online = true;
    await adapter.flush();
    expect([...fake.store.keys()]).toEqual([b.id]);
    expect(fake.store.get(b.id as string)).toMatchObject({ reason: 'dinas', metadata: { scheduleId: 's2' } });
  });
  it('online tapi jaringan putus saat tulis → diantrekan (bukan error), lalu terkirim', async () => {
    const { adapter, fake, net } = setup();
    net.dropWrites = true;
    const r = await adapter.addDocument(C, doc());
    expect(await adapter.getStatus()).toEqual({ pending: 1, failed: 0 });
    net.dropWrites = false;
    await adapter.flush();
    expect(fake.store.has(r.id as string)).toBe(true);
  });
  it('update saat ada antrean untuk dokumen itu ikut antre (urutan terjaga)', async () => {
    const { adapter, fake, net } = setup();
    net.dropWrites = true;
    const r = await adapter.addDocument(C, doc());
    net.dropWrites = false; // online lagi, tetapi add belum terkirim
    await adapter.updateDocument(C, r.id as string, { reason: 'izin' });
    expect(await adapter.getStatus()).toEqual({ pending: 2, failed: 0 });
    await adapter.flush();
    expect(fake.store.get(r.id as string)).toMatchObject({ reason: 'izin' });
  });
});

describe('batchWrite offline', () => {
  const g = (id: string, over: Record<string, unknown> = {}) => ({ type: 'set' as const, collectionName: C, id, data: { workspaceId: 'wsA', className: '7A', reason: 'x', ...over } });
  it('offline → satu entri outbox, terlihat di baca (overlay), terkirim sekali saat online', async () => {
    const { adapter, fake, net } = setup();
    await adapter.getDocuments(C, F);
    net.online = false;
    await adapter.batchWrite([g('a'), g('b'), { type: 'delete' as const, collectionName: C, id: 'zzz' }]);
    expect(await adapter.getStatus()).toEqual({ pending: 1, failed: 0 });
    expect((await adapter.getDocuments(C, F)).map((r) => r.id).sort()).toEqual(['a', 'b']);
    net.online = true;
    await adapter.flush(); await adapter.flush();
    expect([...fake.store.keys()].sort()).toEqual(['a', 'b']);
    expect(await adapter.getStatus()).toEqual({ pending: 0, failed: 0 });
  });
  it('jaringan putus saat batch → diantrekan; online + sukses langsung bila tak ada antrean', async () => {
    const { adapter, fake, net } = setup();
    await adapter.batchWrite([g('x1')]);
    expect(fake.store.has('x1')).toBe(true);
    net.dropWrites = true;
    await adapter.batchWrite([g('x2')]);
    expect(await adapter.getStatus()).toEqual({ pending: 1, failed: 0 });
    net.dropWrites = false;
    await adapter.flush();
    expect(fake.store.has('x2')).toBe(true);
  });
  it('batch menyentuh dokumen yang punya antrean → ikut antre (urutan terjaga)', async () => {
    const { adapter, fake, net } = setup();
    net.online = false;
    await adapter.setDocument(C, 'd1', doc());
    net.online = true;
    await adapter.batchWrite([g('d1', { reason: 'baru' })]);
    expect(await adapter.getStatus()).toEqual({ pending: 2, failed: 0 });
    await adapter.flush();
    expect(fake.store.get('d1')).toMatchObject({ reason: 'baru' });
  });
  it('error non-jaringan (denied) dilempar langsung, tidak diantrekan', async () => {
    const { adapter } = setup();
    await expect(adapter.batchWrite([g('a', { workspaceId: 'wsLAIN' })])).rejects.toMatchObject({ kind: 'denied' });
    expect(await adapter.getStatus()).toEqual({ pending: 0, failed: 0 });
  });
});

describe('kegagalan', () => {
  it('error non-jaringan saat tulis langsung dilempar dan TIDAK diantrekan', async () => {
    const { adapter, net } = setup();
    await expect(adapter.addDocument(C, doc({ workspaceId: 'wsLAIN' }))).rejects.toMatchObject({ kind: 'denied' });
    await expect(adapter.addDocument(C, doc({ workspaceId: '' }))).rejects.toMatchObject({ kind: 'bad_request' });
    expect(await adapter.getStatus()).toEqual({ pending: 0, failed: 0 });
    void net;
  });
  it('flush: kegagalan permanen → dead letter, operasi berikutnya tetap jalan; jaringan putus → berhenti & pertahankan', async () => {
    const { adapter, fake, net } = setup();
    net.online = false;
    await adapter.updateDocument(C, 'tidak-ada', { reason: 'x' }); // akan not_found saat flush
    const ok = await adapter.addDocument(C, doc());
    net.online = true;
    net.dropAll = true;
    await adapter.flush();
    expect(await adapter.getStatus()).toEqual({ pending: 2, failed: 0 }); // jaringan putus: tak ada yang hilang
    net.dropAll = false;
    await adapter.flush();
    expect(await adapter.getStatus()).toEqual({ pending: 0, failed: 1 });
    const failed = await adapter.listFailed();
    expect(failed[0]).toMatchObject({ id: 'tidak-ada', type: 'update' });
    expect(failed[0].error).toMatch(/tidak ditemukan/i);
    expect(fake.store.has(ok.id as string)).toBe(true);
  });
  it('subscribe menerima perubahan status', async () => {
    const { adapter, net } = setup();
    const seen: number[] = [];
    adapter.subscribe((s) => seen.push(s.pending));
    net.online = false;
    await adapter.addDocument(C, doc());
    net.online = true;
    await adapter.flush();
    expect(seen).toContain(1);
    expect(seen[seen.length - 1]).toBe(0);
  });
  it('getDocumentFromCache null', async () => {
    const { adapter } = setup();
    expect(await adapter.getDocumentFromCache(C, 'x')).toBeNull();
  });
});
