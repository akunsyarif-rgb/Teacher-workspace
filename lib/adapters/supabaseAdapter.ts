import { COLLECTIONS } from '@/lib/config/constants';

// Adapter Supabase (PostgREST lewat fetch, tanpa dependensi baru) dengan
// bentuk fungsi yang sama dengan firestoreAdapter, untuk koleksi yang
// diaktifkan lewat lib/config/dataBackend.ts. Hanya memakai token Firebase
// pengguna (RLS yang menegakkan workspace); TIDAK pernah memakai secret key.

type Filter = [string, string, unknown];
type Row = Record<string, unknown>;

// Kolom nyata per koleksi (camelCase -> snake_case). Field di luar daftar
// disimpan di kolom jsonb `metadata` agar tidak ada data yang hilang.
const COLUMN_MAP: Record<string, Record<string, string>> = {
  [COLLECTIONS.SESSION_SKIP_REASONS]: {
    workspaceId: 'workspace_id',
    className: 'class_name',
    teacherUid: 'teacher_uid',
    date: 'date',
    reason: 'reason',
  },
};
const SERVER_FIELDS = new Set(['createdAt', 'updatedAt']);

export interface SupabaseAdapterDeps {
  url: string;
  publishableKey: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

function columns(collectionName: string) {
  const map = COLUMN_MAP[collectionName];
  if (!map) throw new Error(`Koleksi ${collectionName} belum dipetakan ke Supabase.`);
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

export function fromRow(collectionName: string, row: Row) {
  const map = columns(collectionName);
  const out: Row = { id: row.id };
  const reverse = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  for (const [col, value] of Object.entries(row)) {
    if (reverse[col]) out[reverse[col]] = value;
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
    if (op !== '==') throw new Error(`Operator ${op} belum didukung adapter Supabase.`);
    const column = field === 'id' ? 'id' : map[field] ?? `metadata->>${field}`;
    params.append(column, `eq.${value}`);
  }
  return params;
}

export function createSupabaseAdapter(deps: SupabaseAdapterDeps) {
  const doFetch = deps.fetchImpl ?? fetch;
  const base = deps.url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

  async function request(path: string, init: RequestInit & { prefer?: string } = {}) {
    const token = await deps.getToken();
    if (!token) throw new Error('Belum login: token tidak tersedia.');
    const res = await doFetch(`${base}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: deps.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  }

  const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`);

  return {
    async getDocuments(collectionName: string, filters: Filter[] = []) {
      const qs = buildFilterParams(collectionName, filters);
      qs.set('select', '*');
      const rows = (await request(`${collectionName}?${qs}`)) as Row[];
      return rows.map((r) => fromRow(collectionName, r));
    },
    async getDocument(collectionName: string, id: string) {
      const rows = (await request(`${collectionName}?id=eq.${encodeURIComponent(id)}&select=*`)) as Row[];
      return rows[0] ? fromRow(collectionName, rows[0]) : null;
    },
    async addDocument(collectionName: string, data: Row) {
      const id = newId();
      const rows = (await request(collectionName, {
        method: 'POST',
        prefer: 'return=representation',
        body: JSON.stringify({ id, ...toRow(collectionName, data) }),
      })) as Row[];
      return fromRow(collectionName, rows[0]);
    },
    async updateDocument(collectionName: string, id: string, data: Row) {
      // Merge metadata: ambil baris lama agar field metadata yang tidak dikirim tidak hilang.
      const current = await this.getDocument(collectionName, id);
      if (!current) throw new Error('Dokumen tidak ditemukan.');
      const rest: Row = { ...(current as Row) };
      delete rest.id;
      delete rest.createdAt;
      delete rest.updatedAt;
      const merged = toRow(collectionName, { ...rest, ...data });
      // workspace_id immutable (aturan proyek); jangan kirim ulang.
      delete merged.workspace_id;
      await request(`${collectionName}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(merged),
      });
    },
    async deleteDocument(collectionName: string, id: string) {
      await request(`${collectionName}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
