// PostgREST palsu in-memory untuk menguji adapter: filter eq/is.null/metadata->>x, order, Range,
// Prefer return=representation & count=exact, on_conflict upsert, updated_at otomatis, dan
// simulasi RLS sederhana (token -> workspace). Bukan pengganti uji RLS Postgres (tests/rls-*).
type Row = Record<string, unknown>;

export interface FakeOpts {
  tokens: Record<string, string>; // token -> workspaceId yang boleh diakses
  rows?: Row[];
  /** Tindakan khusus per permintaan: kembalikan Response-like untuk menimpa, atau undefined. */
  intercept?: (req: { method: string; url: URL; token: string }) => { status: number; body?: unknown } | 'network' | 'hang' | undefined;
}

export function createFakePostgrest(opts: FakeOpts) {
  const store = new Map<string, Row>((opts.rows ?? []).map((r) => [String(r.id), { ...r }]));
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 9, 0, 0, 0, 0) + ++tick * 1000).toISOString().replace('Z', '+00:00');
  const log: { method: string; path: string; token: string }[] = [];

  const matchFilters = (row: Row, url: URL) => {
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
      const actual = k.startsWith('metadata->>') ? (row.metadata as Row | null)?.[k.slice(11)] : row[k];
      if (v === 'is.null') { if (actual !== null && actual !== undefined) return false; continue; }
      if (!v.startsWith('eq.')) throw new Error(`filter tak didukung: ${k}=${v}`);
      if (String(actual) !== v.slice(3)) return false;
    }
    return true;
  };

  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = init.headers as Record<string, string>;
    const token = String(headers.Authorization ?? '').replace('Bearer ', '');
    log.push({ method, path: url.pathname.replace('/rest/v1/', '') + url.search, token });
    const respond = (status: number, body?: unknown, extra: Record<string, string> = {}) => ({
      status, ok: status < 400, headers: new Headers(extra), text: async () => (body === undefined ? '' : JSON.stringify(body)),
    });

    const hook = opts.intercept?.({ method, url, token });
    if (hook === 'network') throw new TypeError('fetch failed');
    if (hook === 'hang') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    if (hook) return respond(hook.status, hook.body);

    const ws = opts.tokens[token];
    if (!ws) return respond(401, { code: 'PGRST301', message: 'JWT invalid' });
    const visible = (r: Row) => r.workspace_id === ws;
    const prefer = headers.Prefer ?? '';
    const wantsRep = prefer.includes('return=representation');

    if (method === 'GET') {
      let list = [...store.values()].filter(visible).filter((r) => matchFilters(r, url));
      list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const total = list.length;
      const range = headers.Range;
      if (range) {
        const [from, to] = range.split('-').map(Number);
        list = list.slice(from, to + 1);
        return respond(200, list, { 'content-range': `${from}-${from + list.length - 1}/${prefer.includes('count=exact') ? total : '*'}` });
      }
      return respond(200, list);
    }
    if (method === 'POST' && url.pathname.endsWith('/rpc/batch_write')) {
      // Emulasi semantik public.batch_write (diuji nyata di tests/rls/cases.ts bagian 10): atomik, merge, RLS.
      const { p_ops } = JSON.parse(String(init.body)) as { p_ops: { op: string; table: string; id?: string; row?: Row }[] };
      const snapshot = new Map([...store].map(([k, v]) => [k, { ...v }]));
      for (const o of p_ops) {
        if (o.op === 'delete') { const cur = store.get(String(o.id)); if (cur && visible(cur)) store.delete(String(o.id)); continue; }
        const row = o.row as Row;
        if (row.workspace_id !== ws) { store.clear(); snapshot.forEach((v, k) => store.set(k, v)); return respond(403, { code: '42501', message: 'rls' }); }
        const cur = store.get(String(row.id));
        if (cur && !visible(cur)) { store.clear(); snapshot.forEach((v, k) => store.set(k, v)); return respond(409, { code: '23505', message: 'dup' }); }
        const meta = { ...((cur?.metadata as Row) ?? {}), ...((row.metadata as Row) ?? {}) };
        store.set(String(row.id), { class_name: null, created_at: stamp(), ...(cur ?? {}), ...row, metadata: meta, updated_at: stamp() });
      }
      return respond(200, p_ops.length);
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init.body));
      const items: Row[] = Array.isArray(body) ? body : [body];
      const out: Row[] = [];
      for (const it of items) {
        if (it.workspace_id !== ws) return respond(403, { code: '42501', message: 'new row violates row-level security policy' });
        const exists = store.has(String(it.id));
        if (exists && !prefer.includes('merge-duplicates')) return respond(409, { code: '23505', message: 'duplicate key' });
        const row = { class_name: null, teacher_uid: null, date: null, reason: null, metadata: {}, created_at: stamp(), ...(exists ? store.get(String(it.id)) : {}), ...it, updated_at: stamp() };
        store.set(String(it.id), row);
        out.push(row);
      }
      return respond(201, wantsRep ? out : undefined);
    }
    if (method === 'PATCH' || method === 'DELETE') {
      const hit = [...store.values()].filter(visible).filter((r) => matchFilters(r, url));
      if (method === 'PATCH') {
        const patch = JSON.parse(String(init.body)) as Row;
        for (const r of hit) { if (patch.workspace_id && patch.workspace_id !== r.workspace_id) return respond(403, { code: '42501', message: 'rls' }); }
        for (const r of hit) store.set(String(r.id), { ...r, ...patch, updated_at: stamp() });
        return wantsRep ? respond(200, hit.map((r) => store.get(String(r.id)))) : respond(204);
      }
      for (const r of hit) store.delete(String(r.id));
      return wantsRep ? respond(200, hit) : respond(204);
    }
    return respond(405, { message: 'method' });
  }) as unknown as typeof fetch;

  return { fetchImpl, store, log, stamp };
}
