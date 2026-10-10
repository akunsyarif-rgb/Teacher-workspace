/*
 * Backfill + rekonsiliasi session_skip_reasons: Firestore -> Supabase.
 * DEFAULT DRY-RUN (hanya membaca & melaporkan). --apply menulis (upsert idempoten per id).
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=... \
 *   SUPABASE_ALLOWED_REFS=<ref-staging> npm run migrate:collection -- --collection <nama> --workspace <wsId> [--apply]   (default koleksi: session_skip_reasons)
 * (npm script memakai `jiti` yang sudah terpasang oleh `npm ci`; tidak mengunduh paket apa pun.)
 *
 * Uji lokal: bila FIRESTORE_EMULATOR_HOST diset, Firestore = emulator (tanpa service account).
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
  const io = createSupabaseBackfillIO(cfg, {
    readFirestore: async (ws, collection) => {
      // workspaces: dokumen tunggal (id = workspace); koleksi lain: semua dokumen milik workspace itu.
      if (collection === 'workspaces') {
        const one = await getFirestore().collection('workspaces').doc(ws).get();
        return one.exists ? [{ id: one.id, data: one.data() as Record<string, unknown> }] : [];
      }
      const snap = await getFirestore().collection(collection).where('workspaceId', '==', ws).get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    },
  }, fetchImpl);
  console.log(`${cfg.apply ? 'APPLY' : 'DRY-RUN'} ref=${cfg.ref} collection=${cfg.collection} workspace=${cfg.workspaceId}`);
  const result = await runBackfill(cfg, io);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.exitCode);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
