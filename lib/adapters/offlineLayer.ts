import { SupabaseAdapterError, type BatchOp } from './supabaseAdapter';

// Lapisan offline untuk adapter Supabase: cache baca + antrean tulis (outbox) yang dikirim ulang
// saat online. Setara tujuan Firestore persistent cache, tetapi eksplisit dan dapat diuji.
//
// Aturan:
//  - Baca: online → server (cache diperbarui); gagal jaringan/offline/timeout → cache bila ada, selain itu error.
//    Hasil selalu ditimpa dengan operasi outbox yang belum terkirim ("read your own writes").
//  - Tulis: online & tanpa antrean untuk dokumen itu → langsung; gagal jaringan → masuk outbox (sukses semu HANYA
//    untuk kegagalan jaringan). Error lain (denied, bad_request, conflict, not_found, auth) dilempar apa adanya.
//  - Flush FIFO, idempoten (set = buat-atau-gabung dengan id klien). Gagal jaringan/auth → berhenti, coba lagi nanti.
//    Gagal permanen → dipindah ke "dead letter" (terlihat di status), tidak pernah hilang diam-diam.
//  - Satu tab (seperti persistentSingleTabManager Firestore). Data dipisah per pengguna lewat nama store.
type Row = Record<string, unknown>;
type Filter = [string, string, unknown];

export interface KVStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export function memoryStore(): KVStore {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
    set: async (k, v) => { m.set(k, structuredClone(v)); },
    del: async (k) => { m.delete(k); },
    keys: async (p) => [...m.keys()].filter((k) => k.startsWith(p)).sort(),
  };
}

// IndexedDB mentah (tanpa dependensi). Bila IndexedDB tidak ada (SSR, mode privat tertentu) → memori (outbox tidak bertahan).
export function indexedDbStore(name: string): KVStore {
  if (typeof indexedDB === 'undefined') return memoryStore();
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction('kv', mode).objectStore('kv'));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)),
    set: async (k, v) => { await tx('readwrite', (s) => s.put(v, k)); },
    del: async (k) => { await tx('readwrite', (s) => s.delete(k)); },
    keys: async (p) => ((await tx('readonly', (s) => s.getAllKeys())) as string[]).filter((k) => typeof k === 'string' && k.startsWith(p)).sort(),
  };
}

export interface BaseAdapter {
  getDocuments(c: string, filters?: Filter[]): Promise<Row[]>;
  getDocument(c: string, id: string): Promise<Row | null>;
  addDocumentWithId(c: string, id: string, data: Row): Promise<Row>;
  setDocument(c: string, id: string, data: Row): Promise<Row>;
  updateDocument(c: string, id: string, data: Row): Promise<Row>;
  deleteDocument(c: string, id: string): Promise<boolean>;
  batchWrite(ops: BatchOp[]): Promise<boolean>;
  generateId(c: string): string;
  rpc?(name: string, args?: Row): Promise<unknown>;
}

export type OutboxOp = { seq: number; type: 'set' | 'update' | 'delete' | 'batch'; collection: string; id: string; data?: Row; batch?: BatchOp[]; queuedAt: number };
export interface SyncStatus { pending: number; failed: number }

const NETWORK_KINDS = new Set(['offline', 'network', 'timeout']);
const isNetworkError = (e: unknown) => e instanceof SupabaseAdapterError && NETWORK_KINDS.has(e.kind);
const RETRY_LATER = new Set(['offline', 'network', 'timeout', 'auth', 'server', 'conflict']);
const pad = (n: number) => String(n).padStart(12, '0');
const hash = (v: unknown) => JSON.stringify(v);

// Padanan filter di sisi klien untuk overlay outbox. Rentang membandingkan string/angka secara leksikal/numerik
// (sama dengan Firestore untuk tanggal ISO); baris tanpa field itu tidak lolos filter rentang.
function matches(row: Row, filters: Filter[]) {
  return filters.every(([f, op, v]) => {
    const x = row[f];
    if (op === '==') return (x ?? null) === (v ?? null);
    if (x === null || x === undefined || v === null || v === undefined) return false;
    if (op === '>=') return (x as string | number) >= (v as string | number);
    if (op === '<=') return (x as string | number) <= (v as string | number);
    if (op === '>') return (x as string | number) > (v as string | number);
    if (op === '<') return (x as string | number) < (v as string | number);
    return false;
  });
}

export function withOfflineSupport(base: BaseAdapter, opts: { store: KVStore; isOnline: () => boolean; now?: () => number }) {
  const { store, isOnline } = opts;
  const now = opts.now ?? Date.now;
  const listeners = new Set<(s: SyncStatus) => void>();
  let flushing: Promise<SyncStatus> | null = null;

  async function ops(): Promise<OutboxOp[]> {
    const keys = await store.keys('o:');
    return (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean) as OutboxOp[];
  }
  async function status(): Promise<SyncStatus> {
    return { pending: (await store.keys('o:')).length, failed: (await store.keys('x:')).length };
  }
  async function notify() {
    const s = await status();
    listeners.forEach((l) => l(s));
  }
  async function enqueue(op: Omit<OutboxOp, 'seq' | 'queuedAt'>) {
    const seq = ((await store.get('meta:seq')) as number | undefined ?? 0) + 1;
    await store.set('meta:seq', seq);
    await store.set(`o:${pad(seq)}`, { ...op, seq, queuedAt: now() });
    await notify();
  }
  const hasPending = async (c: string, id: string) =>
    (await ops()).some((o) => (o.type === 'batch' ? (o.batch ?? []).some((b) => b.collectionName === c && b.id === id) : o.collection === c && o.id === id));

  // Terapkan outbox ke hasil baca supaya perubahan offline langsung terlihat.
  async function overlay(c: string, rows: Row[], filters: Filter[]) {
    const pending = (await ops()).flatMap((o) => (o.type === 'batch'
      ? (o.batch ?? []).filter((b) => b.collectionName === c).map((b) => ({ ...o, type: b.type, collection: b.collectionName, id: b.id, data: b.type === 'set' ? b.data : undefined }))
      : o.collection === c ? [o] : []));
    if (!pending.length) return rows;
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    for (const o of pending) {
      const cur = byId.get(o.id);
      if (o.type === 'delete') byId.delete(o.id);
      else if (o.type === 'set') byId.set(o.id, { ...(cur ?? {}), ...o.data, id: o.id });
      else if (cur) byId.set(o.id, { ...cur, ...o.data, id: o.id });
    }
    return [...byId.values()].filter((r) => matches(r, filters));
  }

  async function flush(): Promise<SyncStatus> {
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        if (!isOnline()) return await status();
        for (const op of await ops()) {
          try {
            if (op.type === 'set') await base.setDocument(op.collection, op.id, op.data ?? {});
            else if (op.type === 'update') await base.updateDocument(op.collection, op.id, op.data ?? {});
            else if (op.type === 'batch') await base.batchWrite(op.batch ?? []);
            else await base.deleteDocument(op.collection, op.id);
            await store.del(`o:${pad(op.seq)}`);
          } catch (e) {
            if (e instanceof SupabaseAdapterError && RETRY_LATER.has(e.kind)) break; // pertahankan urutan, coba lagi nanti
            await store.set(`x:${pad(op.seq)}`, { ...op, error: e instanceof Error ? e.message : String(e), failedAt: now() });
            await store.del(`o:${pad(op.seq)}`);
          }
        }
        return await status();
      } finally {
        flushing = null;
        await notify();
      }
    })();
    return flushing;
  }

  async function readThrough(c: string, filters: Filter[]) {
    const key = `c:${c}:${hash(filters)}`;
    try {
      if (isOnline()) await flush();
      const rows = await base.getDocuments(c, filters);
      await store.set(key, { rows, at: now() });
      return overlay(c, rows, filters);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      const cached = (await store.get(key)) as { rows: Row[] } | undefined;
      if (!cached) throw e; // tidak pernah dimuat → jujur gagal
      return overlay(c, cached.rows, filters);
    }
  }

  return {
    getDocuments: readThrough,

    async getDocument(c: string, id: string) {
      const key = `d:${c}:${id}`;
      let row: Row | null;
      try {
        row = await base.getDocument(c, id);
        await store.set(key, { row });
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        const cached = (await store.get(key)) as { row: Row | null } | undefined;
        if (!cached) throw e;
        row = cached.row;
      }
      const [merged] = await overlay(c, row ? [row] : [], []);
      const pendingSet = (await ops()).find((o) => o.collection === c && o.id === id && o.type === 'set');
      return merged ?? (pendingSet ? { ...pendingSet.data, id } : null);
    },

    async addDocument(c: string, data: Row) {
      const id = base.generateId(c);
      if (isOnline()) {
        try { return await base.addDocumentWithId(c, id, data); } catch (e) { if (!isNetworkError(e)) throw e; }
      }
      // Bisa jadi sudah sampai ke server sebelum jaringan putus: replay `set` idempoten (buat-atau-gabung).
      await enqueue({ type: 'set', collection: c, id, data });
      return { id, ...data };
    },

    async setDocument(c: string, id: string, data: Row) {
      if (isOnline() && !(await hasPending(c, id))) {
        try { return await base.setDocument(c, id, data); } catch (e) { if (!isNetworkError(e)) throw e; }
      }
      await enqueue({ type: 'set', collection: c, id, data });
      return { id, ...data };
    },

    async updateDocument(c: string, id: string, data: Row) {
      if (isOnline() && !(await hasPending(c, id))) {
        try { return await base.updateDocument(c, id, data); } catch (e) { if (!isNetworkError(e)) throw e; }
      }
      await enqueue({ type: 'update', collection: c, id, data });
      return { id, ...data };
    },

    async deleteDocument(c: string, id: string) {
      if (isOnline() && !(await hasPending(c, id))) {
        try { return await base.deleteDocument(c, id); } catch (e) { if (!isNetworkError(e)) throw e; }
      }
      await enqueue({ type: 'delete', collection: c, id });
      return true;
    },

    flush,
    getStatus: status,
    subscribe(fn: (s: SyncStatus) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    /** Dead letter: operasi yang ditolak permanen (untuk ditampilkan/diekspor, tidak dihapus otomatis). */
    async listFailed() { return (await Promise.all((await store.keys('x:')).map((k) => store.get(k)))) as (OutboxOp & { error: string })[]; },
    generateId: (c: string) => base.generateId(c),
    // Cache lokal (diisi getDocument): dipakai untuk memuat profil secepatnya sebelum versi server tiba.
    getDocumentFromCache: async (c: string, id: string) => {
      const cached = (await store.get(`d:${c}:${id}`)) as { row: Row | null } | undefined;
      return cached?.row ?? null;
    },
    rpc: (name: string, args?: Row) => (base.rpc ? base.rpc(name, args) : Promise.reject(new SupabaseAdapterError('bad_request', 'rpc tidak tersedia'))),
    countDocuments: async (c: string, filters: Filter[] = []) => (await readThrough(c, filters)).length,
    // Batch dikirim langsung bila online dan tak ada antrean untuk dokumen terkait; gagal jaringan → satu entri outbox 'batch'
    // (replay idempoten: set-merge/delete). Error lain dilempar.
    async batchWrite(operations: BatchOp[]) {
      if (operations.length === 0) return true;
      let blocked = false;
      for (const o of operations) if (await hasPending(o.collectionName, o.id)) { blocked = true; break; }
      if (isOnline() && !blocked) {
        try { return await base.batchWrite(operations); } catch (e) { if (!isNetworkError(e)) throw e; }
      }
      await enqueue({ type: 'batch', collection: operations[0].collectionName, id: '*', batch: operations });
      return true;
    },
  };
}

export type OfflineAdapter = ReturnType<typeof withOfflineSupport>;
