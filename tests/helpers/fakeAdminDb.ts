// Fake Firestore Admin minimal untuk unit test route/service server:
// get/set/create/update, runTransaction yang DISERIALKAN (meniru isolasi
// transaksi: dua transaksi bersamaan tidak saling menyisip).
export type Doc = Record<string, any>;

export function createFakeAdminDb() {
  const store: Record<string, Doc> = {};
  let idSeq = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const hooks = { commits: 0, failCommitNumber: 0, batchSizes: [] as number[], serverNowMs: undefined as number | undefined };
  const writes: { op: string; path: string; data?: Doc }[] = [];

  const snap = (path: string): any => ({
    id: path.split('/')[1],
    ref: docRef(path.split('/')[0], path.split('/')[1]),
    exists: path in store,
    // Jam server Firestore saat dibaca (DocumentSnapshot.readTime); dapat diatur lewat hooks.serverNowMs.
    readTime: { toMillis: () => hooks.serverNowMs ?? Date.now() },
    data: () => (path in store ? { ...store[path] } : undefined),
    get: (f: string) => store[path]?.[f],
  });

  function apply(op: string, path: string, data?: Doc, merge = false) {
    if (op === 'delete') {
      writes.push({ op, path });
      delete store[path];
      return;
    }
    if (op === 'create' && path in store) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
    if (op === 'update' && !(path in store)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
    writes.push({ op, path, data });
    // Sentinel FieldValue.increment({__increment:n}) dari mock firebase-admin/firestore.
    const resolved: Doc = {};
    for (const [k, v] of Object.entries(data ?? {})) {
      resolved[k] = v && typeof v === 'object' && '__increment' in (v as Doc) ? (store[path]?.[k] ?? 0) + (v as Doc).__increment : v;
    }
    store[path] = op === 'update' || (op === 'set' && merge) ? { ...store[path], ...resolved } : { ...resolved };
  }

  const docRef = (c: string, id: string) => ({
    path: `${c}/${id}`,
    id,
    get: async () => snap(`${c}/${id}`),
    set: async (data: Doc, opts?: { merge?: boolean }) => apply('set', `${c}/${id}`, data, !!opts?.merge),
    create: async (data: Doc) => apply('create', `${c}/${id}`, data),
    update: async (data: Doc) => apply('update', `${c}/${id}`, data),
    delete: async () => apply('delete', `${c}/${id}`),
  });

  type Query = {
    _query: true;
    c: string;
    filters: [string, string, unknown][];
    max: number;
    select: (...f: string[]) => Query;
    where: (f: string, op: string, v: unknown) => Query;
    limit: (n: number) => Query;
    get: () => Promise<ReturnType<typeof runQuery>>;
  };
  const matches = (v: Doc, [f, op, val]: [string, string, unknown]) =>
      op === 'in' ? (val as unknown[]).includes(v[f]) : v[f] === val;
  const runQuery = (c: string, filters: [string, string, unknown][], max = Infinity) => {
    const docs = Object.keys(store)
      .filter((k) => k.startsWith(`${c}/`) && filters.every((flt) => matches(store[k], flt)))
      .slice(0, max)
      .map((k) => snap(k));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (c: string, filters: [string, string, unknown][], max = Infinity): Query => {
    const q: Query = {
      _query: true,
      c,
      filters,
      max,
      select: () => q,
      where: (f, op, v) => query(c, [...filters, [f, op, v]], max),
      limit: (n) => query(c, filters, n),
      get: async () => runQuery(c, filters, max),
    };
    return q;
  };

  const db = {
    collection: (c: string) => ({
      doc: (id?: string) => docRef(c, id ?? `auto${++idSeq}`),
      where: (f: string, op: string, v: unknown) => query(c, [[f, op, v]]),
      get: async () => runQuery(c, []),
    }),
    batch: () => {
      const ops: (() => void)[] = [];
      return {
        update: (ref: { path: string }, data: Doc) => void ops.push(() => apply('update', ref.path, data)),
        delete: (ref: { path: string }) => void ops.push(() => apply('delete', ref.path)),
        set: (ref: { path: string }, data: Doc, opts?: { merge?: boolean }) => void ops.push(() => apply('set', ref.path, data, !!opts?.merge)),
        commit: async () => {
          hooks.commits++;
          if (hooks.failCommitNumber === hooks.commits) throw new Error('DEADLINE_EXCEEDED (simulasi)');
          ops.forEach((o) => o()); // atomik: semua operasi satu batch diterapkan bersama
          hooks.batchSizes.push(ops.length);
        },
      };
    },
    runTransaction: <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const run = async () => {
        const pending: (() => void)[] = [];
        const tx = {
          get: async (ref: { path: string } | Query) => ('_query' in ref ? runQuery(ref.c, ref.filters, ref.max) : snap(ref.path)),
          set: (ref: { path: string }, data: Doc, opts?: { merge?: boolean }) =>
            void pending.push(() => apply('set', ref.path, data, !!opts?.merge)),
          create: (ref: { path: string }, data: Doc) => void pending.push(() => apply('create', ref.path, data)),
          update: (ref: { path: string }, data: Doc) => void pending.push(() => apply('update', ref.path, data)),
        };
        const out = await fn(tx);
        pending.forEach((p) => p()); // commit hanya bila fn selesai tanpa error
        return out;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };

  return {
    db,
    store,
    writes,
    hooks,
    reset() {
      for (const k of Object.keys(store)) delete store[k];
      writes.length = 0;
      idSeq = 0;
      hooks.commits = 0;
      hooks.failCommitNumber = 0;
      hooks.batchSizes = [];
      hooks.serverNowMs = undefined;
    },
  };
}
