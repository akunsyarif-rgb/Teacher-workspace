import { supabaseRequest } from '@/lib/supabase/client';

export type SupabaseFilter = [field: string, operator: string, value: unknown];

const OPERATOR_MAP: Record<string, string> = {
  '==': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
};

function buildPath(table: string, filters: SupabaseFilter[] = []) {
  const params = new URLSearchParams();
  for (const [field, operator, value] of filters) {
    const mapped = OPERATOR_MAP[operator] ?? operator;
    params.set(field, `${mapped}.${String(value)}`);
  }
  return `${encodeURIComponent(table)}${params.toString() ? `?${params.toString()}` : ''}`;
}

function rows<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Adapter fase 3: bentuk operasi dibuat mirip firestoreAdapter supaya
 * repository dapat dipindahkan satu per satu tanpa mengubah controller/UI.
 * Belum menjadi adapter default aplikasi; Firebase tetap menjadi backend aktif.
 */
export async function getDocuments<T = Record<string, any>>(
  table: string,
  filters: SupabaseFilter[] = [],
): Promise<T[]> {
  const data = await supabaseRequest<T[]>(buildPath(table, filters));
  return rows(data);
}

export async function getDocument<T = Record<string, any>>(
  table: string,
  primaryKey: string,
  id: string,
): Promise<(T & { id: string }) | null> {
  const params = new URLSearchParams();
  params.set(primaryKey, `eq.${id}`);
  params.set('limit', '1');
  const data = await supabaseRequest<T[]>(`${encodeURIComponent(table)}?${params.toString()}`);
  const row = rows(data)[0];
  return row ? ({ ...row, id: (row as any).id ?? id } as T & { id: string }) : null;
}

export async function addDocument<T = Record<string, any>>(
  table: string,
  data: Record<string, any>,
): Promise<T> {
  const result = await supabaseRequest<T[]>(encodeURIComponent(table), {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const row = rows(result)[0];
  if (!row) throw new Error(`Supabase tidak mengembalikan dokumen dari ${table}.`);
  return row;
}

export async function setDocument<T = Record<string, any>>(
  table: string,
  primaryKey: string,
  id: string,
  data: Record<string, any>,
): Promise<T> {
  const params = new URLSearchParams();
  params.set(primaryKey, `eq.${id}`);
  const result = await supabaseRequest<T[]>(`${encodeURIComponent(table)}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({ ...data, [primaryKey]: id }),
  });
  const row = rows(result)[0];
  if (!row) throw new Error(`Supabase gagal melakukan upsert ${table}/${id}.`);
  return row;
}

export async function updateDocument<T = Record<string, any>>(
  table: string,
  primaryKey: string,
  id: string,
  data: Record<string, any>,
): Promise<T> {
  const params = new URLSearchParams();
  params.set(primaryKey, `eq.${id}`);
  const result = await supabaseRequest<T[]>(`${encodeURIComponent(table)}?${params.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const row = rows(result)[0];
  if (!row) throw new Error(`Supabase tidak menemukan dokumen ${table}/${id}.`);
  return row;
}

export async function deleteDocument(
  table: string,
  primaryKey: string,
  id: string,
): Promise<boolean> {
  const params = new URLSearchParams();
  params.set(primaryKey, `eq.${id}`);
  await supabaseRequest(`${encodeURIComponent(table)}?${params.toString()}`, {
    method: 'DELETE',
  });
  return true;
}
