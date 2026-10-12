import { createHash } from 'node:crypto';
import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { encodeValue } from '@/lib/backup/valueCodec.mjs';
import { zipStream } from '@/lib/backup/zip.mjs';
import { EXCLUDED, EXPORTED, KNOWN_COLLECTIONS, STANDING_GAPS, type Actor, type CollectionSpec } from './inventory';

// Ekspor data satu workspace sebagai ZIP STREAMING (memori terbatas; tidak ada berkas sementara di disk). Manifest = entri TERAKHIR,
// sehingga arsip yang terputus di tengah jalan tidak pernah tampak lengkap (direktori pusat ZIP juga baru ditulis di akhir).
export const FORMAT = 'teacher-workspace-backup';
export const FORMAT_VERSION = 1;
export const DEFAULT_MAX_DOCS = 60_000;

export type Entry = { name: string; data: Buffer | string | AsyncIterable<Buffer | string> | Iterable<Buffer | string> };
export type UlanganResult =
  | { status: 'included'; exams: number; attempts: number; files: { name: string; data: string }[] }
  | { status: 'not_enabled'; reason: string }
  | { status: 'failed'; reason: string };
export type ExportDeps = {
  db: Firestore;
  now?: Date;
  ulangan?: (actor: Actor) => Promise<UlanganResult>;
};
type FileStat = { name: string; bytes: number; sha256: string };
type CollectionStat = { status: 'included' | 'skipped_by_role'; count: number; file: string | null; bytes: number; sha256: string | null; note: string };
export type AttachmentRef = { source: 'supabase_storage' | 'firebase_storage' | 'external_link' | 'other'; collection: string; docId: string; name: string | null; path: string | null; url: string | null; assignmentId: string | null; studentId: string | null; className: string | null; validPath?: boolean };

const BATCH = 200;

/** Query yang SAMA dipakai untuk menghitung (pra-cek) dan mengekspor. null = tidak diekspor untuk peran ini. */
function queryFor(db: Firestore, actor: Actor, spec: CollectionSpec): Query | null {
  if (spec.kind === 'workspaceDoc') return null;
  const col = db.collection(spec.name);
  if (spec.kind === 'teacherProfiles') return actor.admin ? col.where('workspaceId', '==', actor.ws) : null;
  const base = col.where('workspaceId', '==', actor.ws);
  if (spec.homeroomOnly && !actor.admin) return actor.homeroomClassName ? base.where('className', '==', actor.homeroomClassName) : null;
  return base;
}

/** Perkiraan jumlah dokumen (agregasi count: murah, jauh di bawah biaya membaca dokumen). */
export async function countExportDocs(db: Firestore, actor: Actor): Promise<number> {
  let total = 2; // dokumen workspace + profil sendiri
  for (const spec of EXPORTED) {
    const q = queryFor(db, actor, spec);
    if (q) total += (await q.count().get()).data().count;
  }
  return total;
}

const lineOf = (path: string, data: Record<string, unknown>) => `${JSON.stringify({ p: path, d: encodeValue(data) })}\n`;

export function refsFrom(collection: string, id: string, d: Record<string, unknown>, ws: string): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  const base = { collection, docId: id, assignmentId: typeof d.assignmentId === 'string' ? d.assignmentId : (collection === 'assignments' ? id : null), studentId: typeof d.studentId === 'string' ? d.studentId : null, className: typeof d.className === 'string' ? d.className : null };
  const add = (url: unknown, name: unknown, path: unknown) => {
    const u = typeof url === 'string' ? url : null;
    const p = typeof path === 'string' ? path : null;
    if (!u && !p) return;
    const sb = u?.startsWith('supabase-storage://submission-attachments/') ? u.slice('supabase-storage://submission-attachments/'.length) : null;
    const source: AttachmentRef['source'] = sb ? 'supabase_storage' : u?.startsWith('http') ? 'firebase_storage' : 'other';
    const finalPath = sb ?? p;
    out.push({ ...base, source, name: typeof name === 'string' ? name : null, path: finalPath, url: null, validPath: source === 'supabase_storage' ? !!finalPath && finalPath.startsWith(`submissions/${ws}/`) && finalPath.split('/').length === 5 && !finalPath.split('/').some((x) => !x || x === '.' || x === '..') : undefined });
  };
  if (collection === 'submissions') {
    const list = Array.isArray(d.attachments) ? (d.attachments as Record<string, unknown>[]) : [];
    if (list.length) for (const a of list) add(a?.fileUrl, a?.fileName, a?.filePath);
    else add(d.fileUrl, d.fileName, d.filePath); // submission lama: satu lampiran di field tunggal
    const link = d.externalLink as { url?: unknown } | null | undefined;
    if (link && typeof link.url === 'string') out.push({ ...base, source: 'external_link', name: null, path: null, url: link.url });
  } else if (collection === 'assignments') add(d.materialFileUrl, d.materialFileName, d.materialFilePath);
  return out;
}

export async function* exportEntries(actor: Actor, deps: ExportDeps): AsyncGenerator<Entry> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const files: FileStat[] = [];
  const collections: Record<string, CollectionStat> = {};
  const attachments: AttachmentRef[] = [];

  // Membungkus data entri: menghitung ukuran + SHA-256 isi (tak terkompresi) sambil mengalir.
  const tracked = (name: string, data: Entry['data'], onChunk?: (s: string) => void): Entry => {
    const stat: FileStat = { name, bytes: 0, sha256: '' };
    const hash = createHash('sha256');
    async function* gen(): AsyncGenerator<Buffer | string> {
      const src = typeof data === 'string' || Buffer.isBuffer(data) ? [data] : data;
      for await (const c of src) { const b = typeof c === 'string' ? Buffer.from(c) : c; hash.update(b); stat.bytes += b.length; onChunk?.(b.toString()); yield c; }
      stat.sha256 = hash.digest('hex');
      files.push(stat);
    }
    return { name, data: gen() };
  };

  yield tracked('README.txt', README);

  for (const spec of EXPORTED) {
    const file = `firestore/${spec.name}.ndjson`;
    const stat: CollectionStat = { status: 'included', count: 0, file, bytes: 0, sha256: null, note: spec.why };
    collections[spec.name] = stat;

    async function* lines(): AsyncGenerator<string> {
      let buf = '';
      let n = 0;
      const push = (path: string, data: Record<string, unknown>) => { buf += lineOf(path, data); stat.count++; if (++n % BATCH === 0) { const out = buf; buf = ''; return out; } return null; };
      const docs: AsyncIterable<{ id: string; data: Record<string, unknown>; ref: string }> = (async function* () {
        if (spec.kind === 'workspaceDoc') {
          const d = (await db.collection('workspaces').doc(actor.ws).get()).data() ?? {};
          const clean = { ...d }; for (const f of spec.strip) delete clean[f];
          yield { id: actor.ws, data: clean, ref: `workspaces/${actor.ws}` };
          return;
        }
        if (spec.kind === 'teacherProfiles' && !actor.admin) {
          const d = (await db.collection('teacher_profiles').doc(actor.uid).get()).data();
          if (d) yield { id: actor.uid, data: d, ref: `teacher_profiles/${actor.uid}` };
          return;
        }
        const q = queryFor(db, actor, spec) as Query;
        for await (const snap of q.stream() as unknown as AsyncIterable<QueryDocumentSnapshot>) yield { id: snap.id, data: snap.data(), ref: snap.ref.path };
      })();
      for await (const doc of docs) {
        if (spec.name === 'submissions' || spec.name === 'assignments') attachments.push(...refsFrom(spec.name, doc.id, doc.data, actor.ws));
        const out = push(doc.ref, doc.data);
        if (out) yield out;
      }
      if (buf) yield buf;
    }

    if (spec.kind !== 'workspaceDoc' && spec.kind !== 'teacherProfiles' && !queryFor(db, actor, spec)) {
      stat.status = 'skipped_by_role'; stat.file = null;
      stat.note = actor.admin ? spec.why : `${spec.why} (Tidak diekspor: Anda bukan wali kelas.)`;
      continue;
    }
    yield tracked(file, lines());
    const f = files[files.length - 1];
    stat.bytes = f.bytes; stat.sha256 = f.sha256;
  }

  // Indeks lampiran (referensi saja). URL berisi token tidak ditulis; hanya path/nama.
  const idx = attachments.map((a) => `${JSON.stringify(a)}\n`);
  yield tracked('attachments/index.ndjson', idx);
  const bySource: Record<string, number> = {};
  for (const a of attachments) bySource[a.source] = (bySource[a.source] ?? 0) + 1;

  // Ulangan Harian (Supabase). Kegagalan/nonaktif DICATAT di manifest, tidak menggagalkan seluruh ekspor.
  let ulangan: { status: string; exams?: number; attempts?: number; reason?: string; files?: string[] };
  if (!deps.ulangan) ulangan = { status: 'not_enabled', reason: 'Tidak dikonfigurasi.' };
  else {
    const r = await deps.ulangan(actor).catch((): UlanganResult => ({ status: 'failed', reason: 'ulangan_export_error' }));
    if (r.status === 'included') {
      const names: string[] = [];
      for (const f of r.files) { names.push(f.name); yield tracked(f.name, f.data); }
      ulangan = { status: 'included', exams: r.exams, attempts: r.attempts, files: names };
    } else ulangan = { status: r.status, reason: r.reason };
  }

  // Koleksi akar yang tidak dikenal inventaris → disebut eksplisit (tidak diekspor, tidak dianggap lengkap).
  const unrecognized = (await db.listCollections()).map((c) => c.id).filter((id) => !KNOWN_COLLECTIONS.has(id));
  const totalDocs = Object.values(collections).reduce((s, c) => s + c.count, 0);
  const roleSkips = Object.entries(collections).filter(([, c]) => c.status === 'skipped_by_role').map(([n]) => n);
  const firestoreComplete = unrecognized.length === 0;

  const manifest = {
    format: FORMAT, formatVersion: FORMAT_VERSION, generator: 'Teacher Workspace', exportedAt: now.toISOString(),
    workspace: actor.workspace, exportedBy: { role: actor.role, scope: actor.admin ? 'seluruh workspace' : 'hak guru (data kelas/profil sendiri)' },
    consistency: 'Dibaca per koleksi saat ekspor; bukan snapshot atomik. Hindari mengubah data selama unduhan.',
    firestore: { totalDocs, collections, unrecognizedCollections: unrecognized, skippedByRole: roleSkips },
    ulangan,
    attachments: { index: { file: 'attachments/index.ndjson', count: attachments.length, bySource }, content: 'Isi file lampiran Supabase diunduh terpisah (bagian lampiran). Firebase Storage dan tautan eksternal hanya berupa referensi.' },
    excluded: EXCLUDED, gaps: STANDING_GAPS,
    coverage: {
      firestore: firestoreComplete ? (roleSkips.length ? 'lengkap_sesuai_hak_akses' : 'lengkap') : 'sebagian',
      ulangan: ulangan.status,
      overall: 'sebagian',
      overallReason: 'Backup ini TIDAK mencakup semuanya — lihat daftar gaps dan excluded.',
    },
    files,
  };
  yield { name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` };
}

export function exportZip(actor: Actor, deps: ExportDeps) {
  return zipStream(exportEntries(actor, deps), { now: deps.now });
}

const README = `TEACHER WORKSPACE — ARSIP BACKUP
================================

Berkas ini adalah salinan data workspace Anda. Simpan di tempat pribadi (Files, iCloud Drive, Google Drive pribadi).
Isinya memuat DATA SISWA, termasuk kode akses siswa: jangan dibagikan, dan sebaiknya diunduh dalam bentuk terenkripsi.

Isi:
- manifest.json            Daftar isi, jumlah data per koleksi, SHA-256 tiap berkas, dan CAKUPAN (apa yang termasuk / tidak).
- firestore/*.ndjson       Satu dokumen per baris: {"p":"koleksi/id","d":{...}}. Tipe tanggal/koordinat/referensi dijaga ({"__t":"ts"|"geo"|"ref"|"bytes"|"num"}).
- attachments/index.ndjson Daftar lampiran (referensi saja). Isi file lampiran Supabase diunduh terpisah.
- ulangan/*.json           Data Ulangan Harian (bila fitur aktif).

Memulihkan: gunakan skrip scripts/backup/restore-export.mjs (lihat docs/BACKUP-EKSPOR.md). Pulihkan dulu ke lingkungan uji.
Backup ini bersifat SEBAGIAN: baca bagian "gaps" dan "excluded" di manifest.json.
`;
