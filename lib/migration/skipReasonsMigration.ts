import { toRow } from '../adapters/supabaseAdapter';
import { COLLECTIONS } from '../config/constants';

type Row = Record<string, unknown>;
const COLLECTION = COLLECTIONS.SESSION_SKIP_REASONS;

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
export function firestoreDocToRow(id: string, data: Row): Row & { id: string } {
  if (!id) throw new Error('Dokumen tanpa id — tidak dimigrasi.');
  if (!data.workspaceId || typeof data.workspaceId !== 'string') {
    throw new Error(`Dokumen ${id} tanpa workspaceId — tidak dimigrasi.`);
  }
  return {
    id,
    ...toRow(COLLECTION, { ...data, createdAt: toIso(data.createdAt), updatedAt: toIso(data.updatedAt) }, { keepTimestamps: true }),
  };
}

// Urutkan key secara rekursif agar perbandingan tidak peka urutan jsonb.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Row).sort().map((k) => [k, stable((value as Row)[k])]));
  }
  return value;
}

// Bentuk perbandingan dari baris Supabase hasil firestoreDocToRow ATAUPUN hasil
// query PostgREST: semua kolom data + isi metadata, tanpa timestamp (presisi
// Firestore vs Postgres berbeda). null dan undefined dianggap sama.
function comparable(row: Row) {
  const meta = (row.metadata as Row | null) ?? {};
  return stable({
    workspace_id: row.workspace_id ?? null,
    class_name: row.class_name ?? null,
    teacher_uid: row.teacher_uid ?? null,
    date: row.date ?? null,
    reason: row.reason ?? null,
    metadata: meta,
  }) as Row;
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

export function reconcileSkipReasons(
  firestoreDocs: { id: string; data: Row }[],
  supabaseRows: Row[]
): ReconcileReport {
  const report: ReconcileReport = {
    matched: 0, missingInSupabase: [], extraInSupabase: [], mismatched: [], duplicateIds: [], invalidDocs: [], ok: false,
  };
  const dup = new Set<string>();

  const sb = new Map<string, Row>();
  for (const r of supabaseRows) {
    const id = String(r.id);
    if (sb.has(id)) dup.add(id);
    sb.set(id, r);
  }

  const seen = new Set<string>();
  for (const { id, data } of firestoreDocs) {
    if (seen.has(id)) { dup.add(id); continue; }
    seen.add(id);
    let expected: Row;
    try {
      expected = firestoreDocToRow(id, data);
    } catch {
      report.invalidDocs.push(id);
      continue;
    }
    const row = sb.get(id);
    if (!row) { report.missingInSupabase.push(id); continue; }
    sb.delete(id);
    const a = comparable(expected);
    const b = comparable(row);
    const fields: string[] = [];
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) fields.push(k);
    }
    if (fields.length) report.mismatched.push({ id, fields });
    else report.matched++;
  }
  report.extraInSupabase = [...sb.keys()];
  report.duplicateIds = [...dup];
  report.ok =
    !report.missingInSupabase.length && !report.extraInSupabase.length && !report.mismatched.length &&
    !report.duplicateIds.length && !report.invalidDocs.length;
  return report;
}
