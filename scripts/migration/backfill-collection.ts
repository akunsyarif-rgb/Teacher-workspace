/*
 * Backfill + rekonsiliasi Firestore -> Supabase per workspace, dan rollback data (--reverse).
 * DEFAULT DRY-RUN (hanya membaca & melaporkan). --apply menulis (upsert idempoten per id; TIDAK PERNAH menghapus).
 *
 *   npm run migrate:collection -- --collection <nama|identity|teacher|school|students|submissions|all> --workspace <wsId> [--apply] [--reverse]
 *   (env: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_ALLOWED_REFS, FIREBASE_SERVICE_ACCOUNT, [ALLOW_PRODUCTION_BACKFILL=yes])
 *
 * Tahap (urutan tetap, berhenti di tahap pertama yang tidak bersih saat --apply):
 *   identity = workspaces → teacher_profiles | teacher = koleksi guru + journals/attendances | school = koleksi siswa-facing non-unit
 *   students = students → student_login_codes → student_profiles (unit, harus bersama) | submissions
 * Exit code: 0 bersih | 1 gagal parsial / rekonsiliasi kotor / prasyarat dilanggar | 2 konfigurasi ditolak.
 * Dijalankan lewat `jiti` (npm ci); di iPad pakai GitHub Actions: .github/workflows/supabase-backfill.yml.
 * Uji lokal: bila FIRESTORE_EMULATOR_HOST diset, Firestore = emulator (tanpa service account).
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { appendFileSync } from 'node:fs';
import {
  ConfigError, createSupabaseBackfillIO, parseBackfillConfig, runPlan, runReverse, type PlanLine,
} from '../../lib/migration/backfillRunner';

function table(lines: PlanLine[]) {
  const head = '| koleksi | firestore | supabase | ditulis | hilang | berlebih | beda | duplikat | tak valid | batch gagal | status |';
  const sep = '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|';
  const rows = lines.map((l) => `| ${l.collection} | ${l.firestore} | ${l.supabase} | ${l.upserted} | ${l.missing} | ${l.extra} | ${l.mismatched} | ${l.duplicates} | ${l.invalid} | ${l.failedBatches} | ${l.ok ? 'BERSIH' : 'PERLU PERHATIAN'}${l.note ? ' — ' + l.note : ''} |`);
  return [head, sep, ...rows].join('\n');
}

async function main() {
  let cfg;
  try {
    cfg = parseBackfillConfig(process.argv.slice(2), process.env);
    if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_SERVICE_ACCOUNT) {
      throw new ConfigError('FIREBASE_SERVICE_ACCOUNT kosong.');
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  }
  initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId: process.env.GCLOUD_PROJECT ?? 'demo-teacher-workspace' }
      : { credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) }
  );
  // Hook uji: hanya mengganti transport (mis. ke server palsu lokal). Guard allowlist/produksi sudah
  // dievaluasi atas SUPABASE_URL di atas, jadi hook ini tidak bisa meloloskan target terlarang.
  let fetchImpl: typeof fetch = fetch;
  if (process.env.NODE_ENV === 'test' && process.env.BACKFILL_TEST_FETCH_MODULE) {
    fetchImpl = (await import(process.env.BACKFILL_TEST_FETCH_MODULE)).default;
  }
  const fdb = getFirestore();
  const io = createSupabaseBackfillIO(cfg, {
    readFirestore: async (ws, collection) => {
      // workspaces: dokumen tunggal (id = workspace); koleksi lain: semua dokumen milik workspace itu.
      if (collection === 'workspaces') {
        const one = await fdb.collection('workspaces').doc(ws).get();
        return one.exists ? [{ id: one.id, data: one.data() as Record<string, unknown> }] : [];
      }
      const snap = await fdb.collection(collection).where('workspaceId', '==', ws).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },
    writeFirestore: async (collection, docs) => {
      const batch = fdb.batch();
      docs.forEach((d) => batch.set(fdb.collection(collection).doc(d.id), d.data, { merge: true }));
      await batch.commit();
    },
  }, fetchImpl);

  const mode = `${cfg.reverse ? 'REVERSE-' : ''}${cfg.apply ? 'APPLY' : 'DRY-RUN'}`;
  console.log(`${mode} ref=${cfg.ref} koleksi=${cfg.collections.join(',')} workspace=${cfg.workspaceId}`);

  let exitCode: 0 | 1 = 0;
  let summary = '';
  if (cfg.reverse) {
    const lines: string[] = [];
    for (const collection of cfg.collections.slice().reverse()) {
      const r = await runReverse({ workspaceId: cfg.workspaceId, apply: cfg.apply, collection }, io);
      lines.push(`${collection}: perlu disalin ke Firestore=${r.toWrite.length}, ditulis=${r.written}${r.error ? ', ERROR ' + r.error : ''}`);
      console.log(JSON.stringify({ collection, ...r, report: r.report }, null, 2));
      if (r.exitCode !== 0) exitCode = 1;
    }
    summary = lines.join('\n');
  } else {
    const plan = await runPlan({ workspaceId: cfg.workspaceId, apply: cfg.apply }, io, cfg.collections);
    exitCode = plan.exitCode;
    summary = table(plan.lines) + (plan.stoppedAt ? `\n\nBERHENTI di ${plan.stoppedAt}: tahap berikutnya tidak dijalankan.` : '');
    for (const [name, r] of Object.entries(plan.results)) if (r.exitCode !== 0) console.log(JSON.stringify({ collection: name, ...r }, null, 2));
  }
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${mode} ${cfg.collections.join(', ')}\n\n${summary}\n`);
  process.exit(exitCode);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
