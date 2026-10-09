import { firestoreDocToRow, reconcileSkipReasons, type ReconcileReport } from './skipReasonsMigration';

type Row = Record<string, unknown>;

// Project yang TIDAK PERNAH boleh jadi target skrip ini.
export const NEVER_ALLOWED_REFS = ['abdkrhmxfpcmgzsxzfyz']; // SmadaExam
export const PRODUCTION_REF = 'htutgpjcynbnyxwgorcb'; // Workflow produksi

export class ConfigError extends Error {}

export interface BackfillConfig {
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
  return { workspaceId, apply: argv.includes('--apply'), url, key: env.SUPABASE_SECRET_KEY, ref };
}

export interface BackfillIO {
  readFirestore(workspaceId: string): Promise<{ id: string; data: Row }[]>;
  readSupabase(workspaceId: string): Promise<Row[]>;
  upsert(rows: Row[]): Promise<void>;
}

export interface BackfillResult {
  exitCode: 0 | 1;
  upserted: number;
  failedBatches: { index: number; error: string }[];
  skippedInvalid: string[];
  report: ReconcileReport;
}

const BATCH = 200;

// Dry-run: hanya membaca. Apply: upsert per batch; kegagalan satu batch tidak
// membatalkan batch lain, tapi membuat exit code 1. Rekonsiliasi SELALU jalan
// terakhir dan satu-satunya penentu "bersih".
export async function runBackfill(
  cfg: { workspaceId: string; apply: boolean },
  io: BackfillIO,
  batchSize = BATCH
): Promise<BackfillResult> {
  const docs = await io.readFirestore(cfg.workspaceId);
  const result: BackfillResult = {
    exitCode: 1, upserted: 0, failedBatches: [], skippedInvalid: [],
    report: undefined as unknown as ReconcileReport,
  };

  if (cfg.apply) {
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const d of docs) {
      if (seen.has(d.id)) continue; // duplikat dilaporkan oleh rekonsiliasi
      seen.add(d.id);
      try {
        const row = firestoreDocToRow(d.id, d.data);
        if (row.workspace_id !== cfg.workspaceId) throw new Error('workspace berbeda');
        rows.push(row);
      } catch {
        result.skippedInvalid.push(d.id);
      }
    }
    for (let i = 0, n = 0; i < rows.length; i += batchSize, n++) {
      const batch = rows.slice(i, i + batchSize);
      try {
        await io.upsert(batch);
        result.upserted += batch.length;
      } catch (e) {
        result.failedBatches.push({ index: n, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const current = await io.readSupabase(cfg.workspaceId);
  result.report = reconcileSkipReasons(docs, current);
  result.exitCode = result.report.ok && !result.failedBatches.length && !result.skippedInvalid.length ? 0 : 1;
  return result;
}

// IO Supabase berbasis PostgREST + secret key (hanya skrip operator; tidak pernah di bundle klien).
export function createSupabaseBackfillIO(
  cfg: Pick<BackfillConfig, 'url' | 'key'>,
  base: Pick<BackfillIO, 'readFirestore'>,
  fetchImpl: typeof fetch = fetch
): BackfillIO {
  async function call(path: string, init: RequestInit = {}) {
    const res = await fetchImpl(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  }
  return {
    readFirestore: base.readFirestore,
    readSupabase: async (ws) =>
      (await call(`session_skip_reasons?workspace_id=eq.${encodeURIComponent(ws)}&select=*`)) as Row[],
    upsert: async (rows) => {
      await call('session_skip_reasons?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
    },
  };
}
