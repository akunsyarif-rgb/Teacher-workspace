/*
 * Backfill + rekonsiliasi session_skip_reasons: Firestore -> Supabase.
 * DEFAULT DRY-RUN (hanya membaca & melaporkan). --apply menulis (upsert idempoten per id).
 *
 *   FIREBASE_SERVICE_ACCOUNT='{...}' SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=... \
 *   npx tsx scripts/migration/backfill-skip-reasons.ts --workspace <wsId> [--apply]
 *
 * Aturan: wajib --workspace (tidak ada backfill semua tenant sekaligus); menolak URL
 * project yang tidak ada di SUPABASE_ALLOWED_REFS; exit code 1 bila rekonsiliasi tidak bersih.
 * Satu sumber kebenaran: jalankan HANYA saat flag koleksi ini mati; setelah hasil bersih,
 * nyalakan flag untuk workspace uji, bukan dual-write.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firestoreDocToRow, reconcileSkipReasons } from '../../lib/migration/skipReasonsMigration';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const wsIdx = args.indexOf('--workspace');
const workspaceId = wsIdx >= 0 ? args[wsIdx + 1] : '';
if (!workspaceId) { console.error('Wajib --workspace <id>'); process.exit(2); }

const url = (process.env.SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SECRET_KEY ?? '';
const allowed = (process.env.SUPABASE_ALLOWED_REFS ?? '').split(',').filter(Boolean);
const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/)?.[1];
if (!ref || !key || !process.env.FIREBASE_SERVICE_ACCOUNT) { console.error('Env belum lengkap'); process.exit(2); }
if (!allowed.includes(ref)) { console.error(`Project ${ref} tidak ada di SUPABASE_ALLOWED_REFS (cegah salah target).`); process.exit(2); }

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)) });
  const snap = await getFirestore().collection('session_skip_reasons').where('workspaceId', '==', workspaceId).get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  console.log(`Firestore: ${docs.length} dokumen (workspace ${workspaceId})`);

  if (apply) {
    const rows = docs.map((d) => firestoreDocToRow(d.id, d.data));
    for (let i = 0; i < rows.length; i += 200) {
      await sb('session_skip_reasons?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 200)),
      });
    }
    console.log(`Upsert ${rows.length} baris.`);
  }

  const current = (await sb(`session_skip_reasons?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`)) as Record<string, unknown>[];
  const report = reconcileSkipReasons(docs, current);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
