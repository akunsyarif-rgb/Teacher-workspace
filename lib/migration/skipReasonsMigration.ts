import { toRow } from '../adapters/supabaseAdapter';
import { COLLECTIONS } from '../config/constants';

type Row = Record<string, unknown>;
const COLLECTION = COLLECTIONS.SESSION_SKIP_REASONS;

// Field yang dibandingkan saat rekonsiliasi (hasil normalisasi; timestamp tidak
// dibandingkan karena Firestore & Postgres presisinya berbeda).
const COMPARED = ['workspaceId', 'className', 'date', 'reason', 'scheduleId', 'note'] as const;

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  const sec = v.seconds ?? v._seconds;
  return typeof sec === 'number' ? new Date(sec * 1000).toISOString() : undefined;
}

// Dokumen Firestore -> baris Supabase (id dipertahankan agar backfill idempoten).
export function firestoreDocToRow(id: string, data: Row): Row & { id: string } {
  if (!data.workspaceId) throw new Error(`Dokumen ${id} tanpa workspaceId — tidak dimigrasi.`);
  return {
    id,
    ...toRow(COLLECTION, { ...data, createdAt: toIso(data.createdAt), updatedAt: toIso(data.updatedAt) }, { keepTimestamps: true }),
  };
}

// Baris Supabase (snake_case + metadata) -> bentuk perbandingan.
function normalizeRow(row: Row) {
  const meta = (row.metadata as Row | null) ?? {};
  return {
    workspaceId: row.workspace_id ?? null,
    className: row.class_name ?? null,
    date: row.date ?? null,
    reason: row.reason ?? null,
    scheduleId: meta.scheduleId ?? null,
    note: meta.note ?? null,
  } as Record<(typeof COMPARED)[number], unknown>;
}

function normalizeDoc(data: Row) {
  return Object.fromEntries(COMPARED.map((k) => [k, data[k] ?? null])) as Record<(typeof COMPARED)[number], unknown>;
}

export interface ReconcileReport {
  matched: number;
  missingInSupabase: string[];
  extraInSupabase: string[];
  mismatched: { id: string; fields: string[] }[];
  ok: boolean;
}

export function reconcileSkipReasons(
  firestoreDocs: { id: string; data: Row }[],
  supabaseRows: Row[]
): ReconcileReport {
  const sb = new Map(supabaseRows.map((r) => [String(r.id), r]));
  const report: ReconcileReport = { matched: 0, missingInSupabase: [], extraInSupabase: [], mismatched: [], ok: false };
  for (const { id, data } of firestoreDocs) {
    const row = sb.get(id);
    if (!row) { report.missingInSupabase.push(id); continue; }
    sb.delete(id);
    const a = normalizeDoc(data);
    const b = normalizeRow(row);
    const fields = COMPARED.filter((k) => a[k] !== b[k]);
    if (fields.length) report.mismatched.push({ id, fields: [...fields] });
    else report.matched++;
  }
  report.extraInSupabase = [...sb.keys()];
  report.ok = !report.missingInSupabase.length && !report.extraInSupabase.length && !report.mismatched.length;
  return report;
}
