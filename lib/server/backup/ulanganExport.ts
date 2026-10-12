import type { Firestore } from 'firebase-admin/firestore';
import { runAction, type Deps, type Rpc } from '@/lib/server/ulanganActions';
import type { IdentitySources } from '@/lib/server/ulanganAuth';
import { isUlanganEnabled } from '@/lib/config/ulangan';
import type { Actor } from './inventory';
import type { UlanganResult } from './exportWorkspace';

// Ekspor Ulangan Harian lewat aksi guru YANG SAMA dengan UI (runAction): otorisasi (guru/OWNER/ADMIN, hanya workspace sendiri) dan
// bentuk data tidak diduplikasi. Berisi kunci jawaban + nilai siswa milik guru ybs → arsip sebaiknya dienkripsi.
const MAX_EXAMS = 300;
const MAX_EVENT_ATTEMPTS = 300;

/** Sumber identitas dari Firestore (sama seperti route /api/ulangan). */
export function firestoreIdentity(db: Firestore): IdentitySources {
  return {
    async getDoc(collection, id) { const s = await db.collection(collection).doc(id).get(); return s.exists ? (s.data() as Record<string, unknown>) : null; },
    async classExists(ws, className) { return !(await db.collection('students').where('workspaceId', '==', ws).where('className', '==', className).limit(1).get()).empty; },
    async listStudents(ws, classNames) {
      const out: { id: string; className: string; name: string }[] = [];
      for (const c of classNames) for (const d of (await db.collection('students').where('workspaceId', '==', ws).where('className', '==', c).get()).docs) out.push({ id: d.id, className: c, name: String(d.get('name') ?? '') });
      return out;
    },
  };
}

type Row = Record<string, unknown>;
export function makeUlanganCollector(deps: { rpc: Rpc; src: IdentitySources }, enabled: boolean = isUlanganEnabled()) {
  const d: Deps = { rpc: deps.rpc, src: deps.src };
  return async (actor: Actor): Promise<UlanganResult> => {
    if (!enabled) return { status: 'not_enabled', reason: 'Fitur Ulangan Harian belum diaktifkan di lingkungan ini; tidak ada data Ulangan yang diekspor.' };
    try {
      const list = ((await runAction('exam.list', actor.uid, {}, d)) as Row[] | null) ?? [];
      if (list.length > MAX_EXAMS) return { status: 'failed', reason: `terlalu_banyak_ulangan_${list.length}` };
      const files: { name: string; data: string }[] = [{ name: 'ulangan/exams.json', data: JSON.stringify(list) }];
      let attempts = 0;
      for (const e of list) {
        const id = String(e.id);
        const detail = await runAction('exam.get', actor.uid, { id }, d);
        const results = (await runAction('exam.results', actor.uid, { id }, d)) as { rows?: Row[] } | null;
        const events: Record<string, unknown> = {};
        const rows = (results?.rows ?? []).filter((r) => r.attempt_id);
        attempts += rows.length;
        for (const r of rows.filter((x) => Number(x.leave_count) > 0).slice(0, MAX_EVENT_ATTEMPTS)) events[String(r.attempt_id)] = await runAction('exam.events', actor.uid, { attemptId: String(r.attempt_id) }, d);
        files.push({ name: `ulangan/exam-${id.replace(/[^a-zA-Z0-9-]/g, '')}.json`, data: JSON.stringify({ detail, results, integrityEvents: events }) });
      }
      return { status: 'included', exams: list.length, attempts, files };
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      const tag = [e instanceof Error ? e.name : 'error', typeof code === 'string' ? code : ''].filter(Boolean).join('_').replace(/[^a-z0-9_]/gi, '').slice(0, 40);
      return { status: 'failed', reason: `ulangan_${tag}` }; // tanpa pesan asli: bisa memuat URL/kunci
    }
  };
}
