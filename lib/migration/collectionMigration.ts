import { backfillRow, idColumn, SUPABASE_MAPPED_COLLECTIONS } from '../adapters/supabaseAdapter';

type Row = Record<string, unknown>;

export function assertMappedCollection(collection: string) {
  if (!SUPABASE_MAPPED_COLLECTIONS.includes(collection)) {
    throw new Error(`Koleksi ${collection} belum dipetakan (dipetakan: ${SUPABASE_MAPPED_COLLECTIONS.join(', ')}).`);
  }
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  const sec = v.seconds ?? v._seconds;
  return typeof sec === 'number' ? new Date(sec * 1000).toISOString() : undefined;
}

// Dokumen Firestore -> baris Supabase (id dipertahankan agar backfill idempoten).
export function firestoreDocToRow(collection: string, id: string, data: Row): Row {
  assertMappedCollection(collection);
  if (!id) throw new Error('Dokumen tanpa id — tidak dimigrasi.');
  if (!data.workspaceId || typeof data.workspaceId !== 'string') {
    throw new Error(`Dokumen ${id} tanpa workspaceId — tidak dimigrasi.`);
  }
  return backfillRow(collection, id, { ...data, createdAt: toIso(data.createdAt), updatedAt: toIso(data.updatedAt) });
}

// Urutkan key secara rekursif agar perbandingan tidak peka urutan jsonb.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Row).sort().map((k) => [k, stable((value as Row)[k])]));
  }
  return value;
}

const IGNORED = new Set(['id', 'user_id', 'code', 'created_at', 'updated_at']);

// Semua kolom data + metadata, tanpa timestamp (presisi Firestore vs Postgres berbeda).
// null/undefined dianggap sama; metadata kosong == tidak ada.
function comparable(row: Row) {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (IGNORED.has(k)) continue;
    if (k === 'metadata') { const m = (v as Row | null) ?? {}; if (Object.keys(m).length) out.metadata = stable(m); continue; }
    if (v === null || v === undefined) continue;
    // jsonb mengurutkan ulang key objek; kolom *_at (timestamptz) dikembalikan Postgres dengan format '+00:00'.
    if (k.endsWith('_at') && typeof v === 'string' && !Number.isNaN(Date.parse(v))) out[k] = new Date(v).toISOString();
    else out[k] = stable(v);
  }
  return out;
}

export interface ReconcileReport {
  matched: number;
  missingInSupabase: string[];
  extraInSupabase: string[];
  mismatched: { id: string; fields: string[] }[];
  duplicateIds: string[];
  invalidDocs: string[];
  ok: boolean;
}

export function reconcileCollection(collection: string, firestoreDocs: { id: string; data: Row }[], supabaseRows: Row[]): ReconcileReport {
  const report: ReconcileReport = {
    matched: 0, missingInSupabase: [], extraInSupabase: [], mismatched: [], duplicateIds: [], invalidDocs: [], ok: false,
  };
  const dup = new Set<string>();
  const sb = new Map<string, Row>();
  const key = idColumn(collection);
  for (const r of supabaseRows) {
    const id = String(r[key]);
    if (sb.has(id)) dup.add(id);
    sb.set(id, r);
  }
  const seen = new Set<string>();
  for (const { id, data } of firestoreDocs) {
    if (seen.has(id)) { dup.add(id); continue; }
    seen.add(id);
    let expected: Row;
    try { expected = firestoreDocToRow(collection, id, data); } catch { report.invalidDocs.push(id); continue; }
    const row = sb.get(id);
    if (!row) { report.missingInSupabase.push(id); continue; }
    sb.delete(id);
    const a = comparable(expected);
    const b = comparable(row);
    const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (fields.length) report.mismatched.push({ id, fields });
    else report.matched++;
  }
  report.extraInSupabase = [...sb.keys()];
  report.duplicateIds = [...dup];
  report.ok = !report.missingInSupabase.length && !report.extraInSupabase.length && !report.mismatched.length &&
    !report.duplicateIds.length && !report.invalidDocs.length;
  return report;
}
