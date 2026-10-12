import { fromRow, idColumn, scopeColumn } from '../adapters/supabaseAdapter';
import { assertMappedCollection, firestoreDocToRow, reconcileCollection, type ReconcileReport } from './collectionMigration';

type Row = Record<string, unknown>;

// Project yang TIDAK PERNAH boleh jadi target skrip ini.
export const NEVER_ALLOWED_REFS = ['abdkrhmxfpcmgzsxzfyz']; // SmadaExam
export const PRODUCTION_REF = 'htutgpjcynbnyxwgorcb'; // Workflow produksi

export class ConfigError extends Error {}

export interface BackfillConfig {
  collection: string;
  /** Hasil resolve nama koleksi/tahap (identity|teacher|school|students|submissions|all). */
  collections: string[];
  /** Mode rollback data: Supabase → Firestore (merge, tanpa hapus). */
  reverse: boolean;
  workspaceId: string;
  apply: boolean;
  url: string;
  key: string;
  ref: string;
}

export function parseBackfillConfig(argv: string[], env: Record<string, string | undefined>): BackfillConfig {
  const wsIdx = argv.indexOf('--workspace');
  const workspaceId = wsIdx >= 0 ? (argv[wsIdx + 1] ?? '') : '';
  if (!workspaceId || workspaceId.startsWith('--')) throw new ConfigError('Wajib --workspace <id>.');

  const cIdx = argv.indexOf('--collection');
  const collection = cIdx >= 0 ? (argv[cIdx + 1] ?? '') : 'session_skip_reasons';
  const collections = resolveCollections(collection);
  try { collections.forEach(assertMappedCollection); } catch (e) { throw new ConfigError(e instanceof Error ? e.message : String(e)); }

  const url = (env.SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) throw new ConfigError('SUPABASE_URL harus https://<ref>.supabase.co.');
  if (!env.SUPABASE_SECRET_KEY) throw new ConfigError('SUPABASE_SECRET_KEY kosong.');

  if (NEVER_ALLOWED_REFS.includes(ref)) throw new ConfigError(`Project ${ref} (SmadaExam) dilarang.`);
  const allowed = (env.SUPABASE_ALLOWED_REFS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(ref)) throw new ConfigError(`Project ${ref} tidak ada di SUPABASE_ALLOWED_REFS.`);
  if (ref === PRODUCTION_REF && env.ALLOW_PRODUCTION_BACKFILL !== 'yes') {
    throw new ConfigError('Project produksi butuh ALLOW_PRODUCTION_BACKFILL=yes (persetujuan eksplisit).');
  }
  return { collection, collections, reverse: argv.includes('--reverse'), workspaceId, apply: argv.includes('--apply'), url, key: env.SUPABASE_SECRET_KEY, ref };
}

export interface BackfillIO {
  readFirestore(workspaceId: string, collection: string): Promise<{ id: string; data: Row }[]>;
  readSupabase(workspaceId: string, collection: string): Promise<Row[]>;
  upsert(rows: Row[], collection: string): Promise<void>;
  /** Apakah workspace sudah ada di Supabase? (urutan FK: workspaces harus lebih dulu). Opsional untuk fake sederhana. */
  workspaceExists?(workspaceId: string): Promise<boolean>;
  /** Hanya untuk mode reverse (rollback): tulis dokumen ke Firestore dengan merge. */
  writeFirestore?(collection: string, docs: { id: string; data: Row }[]): Promise<void>;
}

export interface BackfillResult {
  exitCode: 0 | 1;
  upserted: number;
  failedBatches: { index: number; error: string }[];
  skippedInvalid: string[];
  /** Jumlah dokumen di Firestore / baris di Supabase (untuk laporan). */
  firestoreCount: number;
  supabaseCount: number;
  /** Prasyarat yang dilanggar (mis. workspace belum di-backfill). */
  precondition?: string;
  report: ReconcileReport;
}

const BATCH = 200;
const PAGE = 1000;

// Dry-run: hanya membaca. Apply: upsert per batch; kegagalan satu batch tidak
// membatalkan batch lain, tapi membuat exit code 1. Rekonsiliasi SELALU jalan
// terakhir dan satu-satunya penentu "bersih".
export async function runBackfill(
  cfg: { workspaceId: string; apply: boolean; collection?: string },
  io: BackfillIO,
  batchSize = BATCH
): Promise<BackfillResult> {
  const collection = cfg.collection ?? 'session_skip_reasons';
  assertMappedCollection(collection);
  const docs = await io.readFirestore(cfg.workspaceId, collection);
  const result: BackfillResult = {
    exitCode: 1, upserted: 0, failedBatches: [], skippedInvalid: [], firestoreCount: docs.length, supabaseCount: 0,
    report: undefined as unknown as ReconcileReport,
  };

  // Urutan relasi: semua tabel punya FK ke workspaces. Tulis tanpa workspace di Supabase = gagal; tolak dengan pesan jelas.
  if (cfg.apply && collection !== 'workspaces' && io.workspaceExists && !(await io.workspaceExists(cfg.workspaceId))) {
    result.precondition = `Workspace ${cfg.workspaceId} belum ada di Supabase. Jalankan backfill 'workspaces' lebih dulu.`;
    result.report = reconcileCollection(collection, docs, []);
    return result;
  }

  if (cfg.apply) {
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const d of docs) {
      if (seen.has(d.id)) continue; // duplikat dilaporkan oleh rekonsiliasi
      seen.add(d.id);
      try {
        const row = firestoreDocToRow(collection, d.id, d.data);
        if (collection === 'workspaces' ? row.id !== cfg.workspaceId : row.workspace_id !== cfg.workspaceId) throw new Error('workspace berbeda');
        rows.push(row);
      } catch {
        result.skippedInvalid.push(d.id);
      }
    }
    for (let i = 0, n = 0; i < rows.length; i += batchSize, n++) {
      const batch = rows.slice(i, i + batchSize);
      try {
        await io.upsert(batch, collection);
        result.upserted += batch.length;
      } catch (e) {
        result.failedBatches.push({ index: n, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const current = await io.readSupabase(cfg.workspaceId, collection);
  result.supabaseCount = current.length;
  result.report = reconcileCollection(collection, docs, current);
  result.exitCode = result.report.ok && !result.failedBatches.length && !result.skippedInvalid.length ? 0 : 1;
  return result;
}

// IO Supabase berbasis PostgREST + secret key (hanya skrip operator; tidak pernah di bundle klien).
export function createSupabaseBackfillIO(
  cfg: Pick<BackfillConfig, 'url' | 'key'>,
  base: Pick<BackfillIO, 'readFirestore'> & Partial<Pick<BackfillIO, 'writeFirestore'>>,
  fetchImpl: typeof fetch = fetch
): BackfillIO {
  async function call(path: string, init: RequestInit = {}) {
    const res = await fetchImpl(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    // 201/204 dengan Prefer: return=minimal berbadan kosong — jangan di-parse sebagai JSON.
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    readFirestore: base.readFirestore,
    writeFirestore: base.writeFirestore,
    // Paginasi eksplisit: batas baris PostgREST (default 1000) tidak boleh memotong rekonsiliasi diam-diam.
    readSupabase: async (ws, collection) => {
      const all: Row[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = (await call(
          `${collection}?${scopeColumn(collection)}=eq.${encodeURIComponent(ws)}&select=*&order=${idColumn(collection)}`,
          { headers: { Range: `${offset}-${offset + PAGE - 1}`, 'Range-Unit': 'items' } }
        )) as Row[];
        all.push(...page);
        if (page.length < PAGE) break;
      }
      return all;
    },
    workspaceExists: async (ws) => ((await call(`workspaces?id=eq.${encodeURIComponent(ws)}&select=id&limit=1`)) as Row[]).length > 0,
    upsert: async (rows, collection) => {
      await call(`${collection}?on_conflict=${idColumn(collection)}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tahap cutover: urutan TETAP (identitas → guru → sekolah/siswa-facing → unit siswa → pengumpulan).
// ---------------------------------------------------------------------------
export const STAGES: Record<string, string[]> = {
  identity: ['workspaces', 'teacher_profiles'],
  teacher: ['session_skip_reasons', 'academic_years', 'class_fund_transactions', 'class_inventory', 'student_notes', 'journals', 'attendances'],
  school: ['schedules', 'grade_columns', 'announcements', 'assignments', 'grades', 'student_achievements'],
  students: ['students', 'student_login_codes', 'student_profiles'],
  submissions: ['submissions'],
};

export function resolveCollections(arg: string): string[] {
  if (STAGES[arg]) return STAGES[arg];
  if (arg === 'all') return Object.values(STAGES).flat();
  return [arg];
}

export interface PlanLine {
  collection: string;
  firestore: number;
  supabase: number;
  upserted: number;
  ok: boolean;
  missing: number;
  extra: number;
  mismatched: number;
  duplicates: number;
  invalid: number;
  failedBatches: number;
  note?: string;
}

export function summarize(collection: string, r: BackfillResult): PlanLine {
  return {
    collection, firestore: r.firestoreCount, supabase: r.supabaseCount, upserted: r.upserted,
    ok: r.exitCode === 0, missing: r.report.missingInSupabase.length, extra: r.report.extraInSupabase.length,
    mismatched: r.report.mismatched.length, duplicates: r.report.duplicateIds.length, invalid: r.report.invalidDocs.length,
    failedBatches: r.failedBatches.length, note: r.precondition,
  };
}

/** Jalankan beberapa koleksi berurutan. Berhenti di koleksi pertama yang tidak bersih saat apply (jangan lanjut di atas data rusak). */
export async function runPlan(
  cfg: { workspaceId: string; apply: boolean },
  io: BackfillIO,
  collections: string[]
): Promise<{ exitCode: 0 | 1; lines: PlanLine[]; results: Record<string, BackfillResult>; stoppedAt?: string }> {
  const lines: PlanLine[] = [];
  const results: Record<string, BackfillResult> = {};
  for (const collection of collections) {
    const r = await runBackfill({ ...cfg, collection }, io);
    results[collection] = r;
    lines.push(summarize(collection, r));
    if (cfg.apply && r.exitCode !== 0) {
      return { exitCode: 1, lines, results, stoppedAt: collection };
    }
  }
  return { exitCode: lines.every((l) => l.ok) ? 0 : 1, lines, results };
}

// ---------------------------------------------------------------------------
// ROLLBACK data: salin perubahan Supabase → Firestore (merge; TIDAK PERNAH menghapus). Dipakai setelah flag dimatikan bila
// ada tulisan yang terjadi saat Supabase menjadi sumber kebenaran. Dry-run default.
// ---------------------------------------------------------------------------
export interface ReverseResult { exitCode: 0 | 1; toWrite: string[]; written: number; report: ReconcileReport; error?: string }

export async function runReverse(
  cfg: { workspaceId: string; apply: boolean; collection: string },
  io: BackfillIO
): Promise<ReverseResult> {
  assertMappedCollection(cfg.collection);
  const fsDocs = await io.readFirestore(cfg.workspaceId, cfg.collection);
  const rows = await io.readSupabase(cfg.workspaceId, cfg.collection);
  const before = reconcileCollection(cfg.collection, fsDocs, rows);
  // Yang perlu disalin ke Firestore: baris yang hilang di Firestore atau berbeda isinya. Baris hanya-di-Firestore dibiarkan.
  const need = new Set([...before.extraInSupabase, ...before.mismatched.map((m) => m.id)]);
  const key = idColumn(cfg.collection);
  const docs = rows
    .filter((r) => need.has(String(r[key])))
    .map((r) => {
      const { id, createdAt: _c, updatedAt: _u, ...data } = fromRow(cfg.collection, r) as Row & { id: string };
      void _c; void _u;
      return { id: String(id), data };
    });
  const result: ReverseResult = { exitCode: 1, toWrite: docs.map((d) => d.id), written: 0, report: before };
  if (!cfg.apply) {
    result.exitCode = docs.length === 0 ? 0 : 1; // dry-run: "1" = masih ada selisih yang perlu disalin
    return result;
  }
  if (!io.writeFirestore) { result.error = 'writeFirestore tidak tersedia'; return result; }
  try {
    for (let i = 0; i < docs.length; i += 400) {
      await io.writeFirestore(cfg.collection, docs.slice(i, i + 400));
      result.written += Math.min(400, docs.length - i);
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
  const after = reconcileCollection(cfg.collection, await io.readFirestore(cfg.workspaceId, cfg.collection), rows);
  result.report = after;
  result.exitCode = after.mismatched.length === 0 && after.extraInSupabase.length === 0 ? 0 : 1;
  return result;
}
