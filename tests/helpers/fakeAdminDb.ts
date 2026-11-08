// Fake Firestore Admin minimal untuk unit test route/service server:
// get/set/create/update, runTransaction yang DISERIALKAN (meniru isolasi
// transaksi: dua transaksi bersamaan tidak saling menyisip).
export type Doc = Record<string, any>;

export function createFakeAdminDb() {
  const store: Record<string, Doc> = {};
  let idSeq = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const writes: { op: string; path: string; data?: Doc }[] = [];

  const snap = (path: string) => ({
    id: path.split('/')[1],
    exists: path in store,
    data: () => (path in store ? { ...store[path] } : undefined),
    get: (f: string) => store[path]?.[f],
  });

  function apply(op: string, path: string, data?: Doc, merge = false) {
    if (op === 'create' && path in store) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
    if (op === 'update' && !(path in store)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
    writes.push({ op, path, data });
    store[path] = op === 'update' || (op === 'set' && merge) ? { ...store[path], ...data } : { ...data };
  }

  const docRef = (c: string, id: string) => ({
    path: `${c}/${id}`,
    id,
    get: async () => snap(`${c}/${id}`),
    set: async (data: Doc, opts?: { merge?: boolean }) => apply('set', `${c}/${id}`, data, !!opts?.merge),
    create: async (data: Doc) => apply('create', `${c}/${id}`, data),
    update: async (data: Doc) => apply('update', `${c}/${id}`, data),
  });

  type Query = { _query: true; c: string; filters: [string, unknown][]; select: () => Query; get: () => Promise<ReturnType<typeof runQuery>> };
  const runQuery = (c: string, filters: [string, unknown][]) => {
    const docs = Object.keys(store)
      .filter((k) => k.startsWith(`${c}/`) && filters.every(([f, v]) => store[k][f] === v))
      .map((k) => snap(k));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const query = (c: string, filters: [string, unknown][]): Query => {
    const q: Query = { _query: true, c, filters, select: () => q, get: async () => runQuery(c, filters) };
    return q;
  };

  const db = {
    collection: (c: string) => ({
      doc: (id?: string) => docRef(c, id ?? `auto${++idSeq}`),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]]),
    }),
    runTransaction: <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const run = async () => {
        const pending: (() => void)[] = [];
        const tx = {
          get: async (ref: { path: string } | Query) => ('_query' in ref ? runQuery(ref.c, ref.filters) : snap(ref.path)),
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
    reset() {
      for (const k of Object.keys(store)) delete store[k];
      writes.length = 0;
      idSeq = 0;
    },
  };
}
