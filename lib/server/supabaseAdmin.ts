const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error('Konfigurasi Supabase server belum lengkap.');
  }
  return { url: SUPABASE_URL, key: SUPABASE_SECRET_KEY };
}

function snakeCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function camelCase(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function mapRow(row: Record<string, any>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelCase(key), value]));
}

function mapPayload(data: Record<string, any>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [snakeCase(key), value]));
}

export async function supabaseAdminRequest<T = unknown>(path: string, init: RequestInit = {}) {
  const { url, key } = requireConfig();
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${url}${path}`, { ...init, headers, cache: 'no-store' });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    throw new Error(typeof data === 'object' && data?.message ? data.message : `Supabase admin request gagal (${response.status}).`);
  }
  return { data: data as T, response };
}

export async function adminGetOne<T = any>(table: string, idField: string, id: string) {
  const { data } = await supabaseAdminRequest<Record<string, any>[]>(
    `/rest/v1/${table}?${snakeCase(idField)}=eq.${encodeURIComponent(id)}&limit=1`
  );
  return data?.[0] ? (mapRow(data[0]) as T) : null;
}

export async function adminSelect<T = any>(table: string, filters: [string, string, unknown][] = []) {
  const params = new URLSearchParams({ select: '*' });
  const ops: Record<string, string> = { '==': 'eq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '!=': 'neq' };
  for (const [field, op, value] of filters) params.set(snakeCase(field), `${ops[op] || op}.${String(value)}`);
  const { data } = await supabaseAdminRequest<Record<string, any>[]>(`/rest/v1/${table}?${params.toString()}`);
  return (data || []).map(mapRow) as T[];
}

export async function adminCount(table: string, filters: [string, string, unknown][] = []) {
  const params = new URLSearchParams({ select: 'id' });
  const ops: Record<string, string> = { '==': 'eq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '!=': 'neq' };
  for (const [field, op, value] of filters) params.set(snakeCase(field), `${ops[op] || op}.${String(value)}`);
  const { response } = await supabaseAdminRequest(`/rest/v1/${table}?${params.toString()}`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const total = Number((response.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

export async function adminUpsert(table: string, rows: Record<string, any> | Record<string, any>[]) {
  const payload = Array.isArray(rows) ? rows.map(mapPayload) : mapPayload(rows);
  await supabaseAdminRequest(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  });
}

export async function adminUpdate(table: string, filters: [string, string, unknown][], data: Record<string, any>) {
  const params = new URLSearchParams();
  const ops: Record<string, string> = { '==': 'eq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '!=': 'neq' };
  for (const [field, op, value] of filters) params.set(snakeCase(field), `${ops[op] || op}.${String(value)}`);
  await supabaseAdminRequest(`/rest/v1/${table}?${params.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(mapPayload(data)),
  });
}

export async function adminDelete(table: string, filters: [string, string, unknown][]) {
  const params = new URLSearchParams();
  const ops: Record<string, string> = { '==': 'eq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '!=': 'neq' };
  for (const [field, op, value] of filters) params.set(snakeCase(field), `${ops[op] || op}.${String(value)}`);
  await supabaseAdminRequest(`/rest/v1/${table}?${params.toString()}`, { method: 'DELETE' });
}
