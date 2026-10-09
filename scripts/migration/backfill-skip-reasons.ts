/*
 * Backfill + rekonsiliasi session_skip_reasons: Firestore -> Supabase.
 * DEFAULT DRY-RUN (hanya membaca & melaporkan). --apply menulis (upsert idempoten per id).
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=... \
 *   SUPABASE_ALLOWED_REFS=<ref-staging> npx tsx scripts/migration/backfill-skip-reasons.ts --workspace <wsId> [--apply]
 *
 * Exit code: 0 bersih | 1 gagal parsial / rekonsiliasi tidak bersih | 2 konfigurasi ditolak.
 * Logika ada di lib/migration/backfillRunner.ts (diuji tanpa jaringan).
 * Satu sumber kebenaran: jalankan HANYA saat flag koleksi ini mati; tanpa dual-write.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ConfigError, createSupabaseBackfillIO, parseBackfillConfig, runBackfill } from '../../lib/migration/backfillRunner';

async function main() {
  let cfg;
  try {
    cfg = parseBackfillConfig(process.argv.slice(2), process.env);
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new ConfigError('FIREBASE_SERVICE_ACCOUNT kosong.');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  }
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) });
  const io = createSupabaseBackfillIO(cfg, {
    readFirestore: async (ws) => {
      const snap = await getFirestore().collection('session_skip_reasons').where('workspaceId', '==', ws).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },
  });
  console.log(`${cfg.apply ? 'APPLY' : 'DRY-RUN'} ref=${cfg.ref} workspace=${cfg.workspaceId}`);
  const result = await runBackfill(cfg, io);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.exitCode);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
