import { COLLECTIONS } from '../config/constants';

// Adapter Supabase (PostgREST lewat fetch, tanpa dependensi baru) dengan bentuk
// fungsi yang sejajar firestoreAdapter, untuk koleksi yang diaktifkan lewat
// lib/config/dataBackend.ts. Memakai token Firebase pengguna (RLS yang menegakkan
// workspace); TIDAK pernah memakai secret key.
//
// Prinsip: tidak ada kegagalan yang disembunyikan. Setiap operasi yang tidak
// terbukti berhasil melempar SupabaseAdapterError dengan `kind` yang jelas; tidak
// ada fallback ke Firestore dan tidak ada antrean offline (Firestore punya,
// Supabase tidak — lihat docs/MIGRASI-SKIP-REASONS.md bagian Offline).

type Filter = [string, string, unknown];
type Row = Record<string, unknown>;

export type SupabaseErrorKind =
  | 'offline' | 'network' | 'timeout' | 'auth' | 'denied' | 'conflict' | 'not_found' | 'bad_request' | 'server';

export class SupabaseAdapterError extends Error {
  constructor(public kind: SupabaseErrorKind, message: string, public status?: number, public code?: string) {
    super(message);
    this.name = 'SupabaseAdapterError';
  }
}

// Kolom nyata per koleksi (camelCase -> snake_case). Field di luar daftar disimpan
// di kolom jsonb `metadata` agar tidak ada data yang hilang.
const COLUMN_MAP: Record<string, Record<string, string>> = {
  [COLLECTIONS.SESSION_SKIP_REASONS]: {
    workspaceId: 'workspace_id',
    className: 'class_name',
    teacherUid: 'teacher_uid',
    date: 'date',
    reason: 'reason',
  },
  [COLLECTIONS.ACADEMIC_YEARS]: {
    workspaceId: 'workspace_id',
    label: 'label',
    startDate: 'start_date',
    endDate: 'end_date',
    isActive: 'is_active',
  },
  [COLLECTIONS.CLASS_FUND]: {
    workspaceId: 'workspace_id',
    className: 'class_name',
    studentId: 'student_id',
    amount: 'amount',
    type: 'type',
  },
  [COLLECTIONS.CLASS_INVENTORY]: {
    workspaceId: 'workspace_id',
    className: 'class_name',
    name: 'name',
    quantity: 'quantity',
    unit: 'unit',
  },
  [COLLECTIONS.SCHEDULES]: {
    workspaceId: 'workspace_id',
    className: 'class_name',
    date: 'date',
    day: 'day',
    timeSlot: 'time_slot',
    subject: 'subject',
    teacherName: 'teacher_name',
  },
  [COLLECTIONS.GRADE_COLUMNS]: {
    workspaceId: 'workspace_id',
    className: 'class_name',
    name: 'name',
    weight: 'weight',
    title: 'title',
    type: 'type',
  },
  [COLLECTIONS.STUDENT_NOTES]: {
    workspaceId: 'workspace_id',
    className: 'class_name',
    studentId: 'student_id',
    teacherUid: 'teacher_uid',
    category: 'category',
  },
};

/** Koleksi yang sudah punya pemetaan kolom di adapter ini. */
export const SUPABASE_MAPPED_COLLECTIONS = Object.keys(COLUMN_MAP);
const SERVER_FIELDS = new Set(['createdAt', 'updatedAt']);
const IDENT = /^[A-Za-z0-9_]+$/;

function columns(collectionName: string) {
  const map = COLUMN_MAP[collectionName];
  if (!map) throw new SupabaseAdapterError('bad_request', `Koleksi ${collectionName} belum dipetakan ke Supabase.`);
  return map;
}

export function toRow(collectionName: string, data: Row, opts: { keepTimestamps?: boolean } = {}) {
  const map = columns(collectionName);
  const row: Row = {};
  const metadata: Row = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || SERVER_FIELDS.has(key)) continue;
    if (map[key]) row[map[key]] = value;
    else metadata[key] = value;
  }
  if (Object.keys(metadata).length > 0) row.metadata = metadata;
  if (opts.keepTimestamps) {
    if (data.createdAt) row.created_at = data.createdAt;
    if (data.updatedAt) row.updated_at = data.updatedAt;
  }
  return row;
}

// Kolom null dipertahankan sebagai null (aplikasi menulis null eksplisit, mis. academic_years.endDate).
// createdAt/updatedAt berupa string ISO, BUKAN Timestamp Firestore — pemanggil yang butuh .toDate() harus
// disesuaikan sebelum koleksinya dialihkan.
export function fromRow(collectionName: string, row: Row) {
  const map = columns(collectionName);
  const out: Row = { id: row.id };
  const reverse = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  for (const [col, value] of Object.entries(row)) {
    if (reverse[col] && value !== undefined) out[reverse[col]] = value;
  }
  Object.assign(out, (row.metadata as Row | null) ?? {});
  if (row.created_at) out.createdAt = row.created_at;
  if (row.updated_at) out.updatedAt = row.updated_at;
  return out;
}

export function buildFilterParams(collectionName: string, filters: Filter[]) {
  const map = columns(collectionName);
  const params = new URLSearchParams();
  for (const [field, op, value] of filters) {
    if (op !== '==') throw new SupabaseAdapterError('bad_request', `Operator ${op} belum didukung adapter Supabase.`);
    if (!IDENT.test(field)) throw new SupabaseAdapterError('bad_request', `Nama field tidak valid: ${field}`);
    const column = field === 'id' ? 'id' : map[field] ?? `metadata->>${field}`;
    params.append(column, value === null ? 'is.null' : `eq.${value}`);
  }
  return params;
}

function requireWorkspace(filters: Filter[]) {
  const ok = filters.some(([f, op, v]) => f === 'workspaceId' && op === '==' && typeof v === 'string' && v.length > 0);
  if (!ok) throw new SupabaseAdapterError('bad_request', 'Query wajib difilter workspaceId (isolasi tenant).');
}

export interface SupabaseAdapterDeps {
  url: string;
  publishableKey: string;
  /** forceRefresh=true dipakai satu kali setelah 401 (token kedaluwarsa). */
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pageSize?: number;
  maxGetRetries?: number;
  isOnline?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

interface Res { status: number; body: unknown; headers: Headers | { get(n: string): string | null } }

export function createSupabaseAdapter(deps: SupabaseAdapterDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const pageSize = deps.pageSize ?? 1000;
  const maxGetRetries = deps.maxGetRetries ?? 2;
  const isOnline = deps.isOnline ?? (() => !(typeof navigator !== 'undefined' && navigator.onLine === false));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  function classify(status: number, body: unknown): SupabaseAdapterError {
    const b = (body && typeof body === 'object' ? body : {}) as { code?: string; message?: string };
    const msg = `Supabase ${status}${b.code ? ` ${b.code}` : ''}: ${String(b.message ?? (typeof body === 'string' ? body : '')).slice(0, 200)}`;
    if (status === 401) return new SupabaseAdapterError('auth', msg, status, b.code);
    if (status === 403 || b.code === '42501') return new SupabaseAdapterError('denied', msg, status, b.code);
    if (status === 409 || b.code === '23505') return new SupabaseAdapterError('conflict', msg, status, b.code);
    if (status === 404) return new SupabaseAdapterError('not_found', msg, status, b.code);
    if (status >= 400 && status < 500) return new SupabaseAdapterError('bad_request', msg, status, b.code);
    return new SupabaseAdapterError('server', msg, status, b.code);
  }

  async function once(path: string, init: RequestInit & { prefer?: string; range?: string }, forceRefresh: boolean): Promise<Res> {
    const token = await deps.getToken(forceRefresh);
    if (!token) throw new SupabaseAdapterError('auth', 'Belum login: token tidak tersedia.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}/rest/v1/${path}`, {
        ...init,
        signal: ctl.signal,
        headers: {
          apikey: deps.publishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.prefer ? { Prefer: init.prefer } : {}),
          ...(init.range ? { Range: init.range, 'Range-Unit': 'items' } : {}),
        },
      });
      const text = await res.text();
      let body: unknown = null;
      if (text) { try { body = JSON.parse(text); } catch { body = text; } }
      return { status: res.status, body, headers: res.headers };
    } catch (e) {
      if (ctl.signal.aborted) throw new SupabaseAdapterError('timeout', `Supabase tidak merespons dalam ${timeoutMs / 1000} detik.`);
      throw new SupabaseAdapterError('network', `Gagal menghubungi Supabase: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // GET boleh diulang (idempoten) untuk gangguan jaringan/5xx; tulisan TIDAK PERNAH diulang otomatis.
  async function request(path: string, init: RequestInit & { prefer?: string; range?: string } = {}): Promise<Res> {
    if (!isOnline()) throw new SupabaseAdapterError('offline', 'Sedang offline: perubahan tidak dapat disimpan ke Supabase.');
    const isGet = (init.method ?? 'GET') === 'GET';
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        let res = await once(path, init, false);
        if (res.status === 401 && !refreshed) { refreshed = true; res = await once(path, init, true); }
        if (res.status >= 200 && res.status < 300) return res;
        const err = classify(res.status, res.body);
        if (isGet && err.kind === 'server' && attempt < maxGetRetries) { await sleep(200 * 2 ** attempt); continue; }
        throw err;
      } catch (e) {
        const retryable = e instanceof SupabaseAdapterError && (e.kind === 'network' || e.kind === 'timeout');
        if (isGet && retryable && attempt < maxGetRetries) { await sleep(200 * 2 ** attempt); continue; }
        throw e;
      }
    }
  }

  const rows = (res: Res) => (Array.isArray(res.body) ? (res.body as Row[]) : []);
  const idParam = (id: string) => `id=eq.${encodeURIComponent(id)}`;
  const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`;

  async function fetchRaw(collectionName: string, id: string): Promise<Row | null> {
    columns(collectionName);
    const res = await request(`${collectionName}?${idParam(id)}&select=*`);
    return rows(res)[0] ?? null;
  }

  const api = {
    async getDocuments(collectionName: string, filters: Filter[] = []) {
      requireWorkspace(filters);
      const out: Row[] = [];
      // Paginasi eksplisit: batas baris PostgREST (default 1000) tidak boleh memotong hasil diam-diam.
      for (let offset = 0; ; offset += pageSize) {
        const qs = buildFilterParams(collectionName, filters);
        qs.set('select', '*');
        qs.set('order', 'id');
        const res = await request(`${collectionName}?${qs}`, { range: `${offset}-${offset + pageSize - 1}` });
        const page = rows(res);
        out.push(...page);
        if (page.length < pageSize) break;
      }
      return out.map((r) => fromRow(collectionName, r));
    },

    async getDocument(collectionName: string, id: string) {
      const raw = await fetchRaw(collectionName, id);
      return raw ? fromRow(collectionName, raw) : null;
    },

    // Supabase tidak punya cache lokal: selalu miss (pemanggil memperlakukan null sebagai "belum ada").
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- tanda tangan sejajar firestoreAdapter
    async getDocumentFromCache(_collectionName: string, _id: string) {
      return null;
    },

    async countDocuments(collectionName: string, filters: Filter[] = []) {
      requireWorkspace(filters);
      const qs = buildFilterParams(collectionName, filters);
      qs.set('select', 'id');
      const res = await request(`${collectionName}?${qs}`, { prefer: 'count=exact', range: '0-0' });
      const total = Number(String(res.headers.get('content-range') ?? '').split('/')[1]);
      if (!Number.isFinite(total)) throw new SupabaseAdapterError('server', 'Supabase tidak mengembalikan jumlah baris.');
      return total;
    },

    async addDocument(collectionName: string, data: Row) {
      return api.addDocumentWithId(collectionName, newId(), data);
    },

    // Insert dengan id yang ditentukan pemanggil (id klien untuk antrean offline). Id sudah ada → error `conflict`.
    async addDocumentWithId(collectionName: string, id: string, data: Row) {
      if (typeof data.workspaceId !== 'string' || !data.workspaceId) {
        throw new SupabaseAdapterError('bad_request', 'Dokumen wajib punya workspaceId.');
      }
      const res = await request(collectionName, {
        method: 'POST', prefer: 'return=representation', body: JSON.stringify({ id, ...toRow(collectionName, data) }),
      });
      if (rows(res).length !== 1) throw new SupabaseAdapterError('server', 'Penulisan tidak terkonfirmasi (baris tidak dikembalikan).');
      return { id, ...data };
    },

    // Seperti Firestore updateDoc: gagal bila dokumen tidak ada; field yang tidak disebut dipertahankan.
    // Compare-and-swap pada updated_at supaya update bersamaan tidak saling menimpa metadata.
    async updateDocument(collectionName: string, id: string, data: Row) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await fetchRaw(collectionName, id);
        if (!current) throw new SupabaseAdapterError('not_found', 'Dokumen tidak ditemukan atau tidak boleh diakses.');
        if (data.workspaceId !== undefined && data.workspaceId !== current.workspace_id) {
          throw new SupabaseAdapterError('bad_request', 'workspaceId tidak boleh diubah.');
        }
        const merged: Row = { ...fromRow(collectionName, current), ...data };
        delete merged.id;
        const patch = toRow(collectionName, merged);
        delete patch.workspace_id;
        const guard = current.updated_at ? `&updated_at=eq.${encodeURIComponent(String(current.updated_at))}` : '';
        const res = await request(`${collectionName}?${idParam(id)}${guard}`, {
          method: 'PATCH', prefer: 'return=representation', body: JSON.stringify(patch),
        });
        if (rows(res).length === 1) return { id, ...data };
        // 0 baris: berubah oleh pihak lain (ulang) atau dilarang RLS/dihapus (fetchRaw berikutnya yang memutuskan).
      }
      throw new SupabaseAdapterError('conflict', 'Dokumen berubah bersamaan; perubahan tidak disimpan. Coba lagi.');
    },

    // Seperti Firestore setDoc(merge:true): buat bila belum ada, gabung bila sudah.
    async setDocument(collectionName: string, id: string, data: Row) {
      const existing = await fetchRaw(collectionName, id);
      if (existing) return api.updateDocument(collectionName, id, data);
      if (typeof data.workspaceId !== 'string' || !data.workspaceId) {
        throw new SupabaseAdapterError('bad_request', 'Dokumen wajib punya workspaceId.');
      }
      try {
        const res = await request(collectionName, {
          method: 'POST', prefer: 'return=representation', body: JSON.stringify({ id, ...toRow(collectionName, data) }),
        });
        if (rows(res).length !== 1) throw new SupabaseAdapterError('server', 'Penulisan tidak terkonfirmasi (baris tidak dikembalikan).');
        return { id, ...data };
      } catch (e) {
        if (e instanceof SupabaseAdapterError && e.kind === 'conflict') return api.updateDocument(collectionName, id, data);
        throw e;
      }
    },

    // Firestore: menghapus dokumen yang tidak ada = sukses. Supabase: 0 baris terhapus karena RLS
    // TIDAK boleh tampak sukses, jadi dibedakan dengan membaca ulang.
    async deleteDocument(collectionName: string, id: string) {
      columns(collectionName);
      const res = await request(`${collectionName}?${idParam(id)}`, { method: 'DELETE', prefer: 'return=representation' });
      if (rows(res).length === 1) return true;
      if (await fetchRaw(collectionName, id)) throw new SupabaseAdapterError('denied', 'Penghapusan ditolak (tidak berwenang).');
      return true;
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- tanda tangan sejajar firestoreAdapter
    generateId(_collectionName: string) {
      return newId();
    },

    // Firestore batch = atomik lintas koleksi; PostgREST tidak punya padanannya. Menolak keras
    // daripada meniru secara tidak atomik: koleksi yang butuh batch belum boleh dialihkan.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- tanda tangan sejajar firestoreAdapter
    async batchWrite(_operations: unknown[]): Promise<never> {
      throw new SupabaseAdapterError('bad_request', 'batchWrite belum didukung adapter Supabase (butuh RPC transaksional).');
    },
  };
  return api;
}
