import { createHash } from 'node:crypto';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ulanganAuthHeaders } from '@/lib/server/ulanganSupabase';
import { refsFrom, type Entry } from './exportWorkspace';
import type { Actor } from './inventory';
import { resolveMaxDocs } from './limits';

// Lampiran pengumpulan tugas (Supabase Storage, bucket privat) diunduh dalam BAGIAN-bagian kecil agar tiap permintaan terbatas
// waktu/memorinya. Isolasi workspace: HANYA path berawalan submissions/<workspaceId>/ (sama seperti route sign lampiran).
export const BUCKET = 'submission-attachments';
export const MAX_PATHS_PER_PART = 30;
export const MAX_PART_BYTES = 40 * 1024 * 1024;
const MAX_PATH_LEN = 400;

export type PlanFile = { path: string; name: string | null; assignmentId: string | null; studentId: string | null; className: string | null };
export type StorageDeps = { url: string; key: string; fetchImpl?: typeof fetch };

export class AttachmentLimitError extends Error {
  constructor(public total: number, public max: number) {
    super('too_many_submissions');
    this.name = 'AttachmentLimitError';
  }
}

/** Menolak SEBELUM pemindaian penuh bila jumlah submissions workspace melebihi batas (count() murah; stream() tidak dipanggil). */
export async function planAttachments(db: Firestore, actor: Actor, opts: { maxDocs?: number } = {}): Promise<PlanFile[]> {
  const maxDocs = opts.maxDocs ?? resolveMaxDocs().value;
  const total = (await db.collection('submissions').where('workspaceId', '==', actor.ws).count().get()).data().count;
  if (total > maxDocs) throw new AttachmentLimitError(total, maxDocs);
  const seen = new Map<string, PlanFile>();
  const q = db.collection('submissions').where('workspaceId', '==', actor.ws);
  for await (const snap of q.stream() as unknown as AsyncIterable<QueryDocumentSnapshot>) {
    for (const r of refsFrom('submissions', snap.id, snap.data(), actor.ws)) {
      if (r.source === 'supabase_storage' && r.validPath && r.path && !seen.has(r.path)) seen.set(r.path, { path: r.path, name: r.name, assignmentId: r.assignmentId, studentId: r.studentId, className: r.className });
    }
  }
  return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

export class PathError extends Error {}
export function validatePaths(ws: string, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS_PER_PART) throw new PathError('invalid_paths');
  const prefix = `submissions/${ws}/`;
  return paths.map((p) => {
    if (typeof p !== 'string' || p.length > MAX_PATH_LEN || !p.startsWith(prefix)) throw new PathError('path_outside_workspace');
    const parts = p.split('/');
    if (parts.length !== 5 || parts.some((x) => !x || x === '.' || x === '..')) throw new PathError('invalid_path'); // submissions/{ws}/{assignment}/{uid}/{file}
    return p;
  });
}

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const objUrl = (s: StorageDeps, path: string) => `${s.url}/storage/v1/object/authenticated/${BUCKET}/${enc(path)}`;

export type PartPlan = { included: number; sizes: (number | null)[]; oversized: string[]; unknown: string[] };

const parseLength = (v: string | null): number | null => (v !== null && /^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : null);

/** Ukuran dari HEAD: angka (0 untuk 404 = file tidak ada), atau null bila TIDAK DIKETAHUI (HEAD gagal/non-2xx/content-length hilang atau tidak valid). */
async function headSize(s: StorageDeps, path: string): Promise<number | null> {
  const f = s.fetchImpl ?? fetch;
  try {
    const r = await f(objUrl(s, path), { method: 'HEAD', headers: ulanganAuthHeaders(s.key), cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (r.status === 404) return 0;
    if (!r.ok) return null;
    return parseLength(r.headers.get('content-length'));
  } catch { return null; }
}

/**
 * Tentukan berapa path (awalan daftar) yang muat dalam satu bagian. Minimal 1.
 * Fail-safe: ukuran tidak diketahui TIDAK dianggap 0 — file itu dihitung penuh (MAX_PART_BYTES) sehingga selalu sendirian dalam bagiannya.
 * File yang diketahui > MAX_PART_BYTES tidak diunduh (status too_large di part-manifest), bukan dimasukkan diam-diam.
 */
export async function probePart(s: StorageDeps, paths: string[]): Promise<PartPlan> {
  const sizes = await Promise.all(paths.map((p) => headSize(s, p)));
  const oversized: string[] = []; const unknown: string[] = [];
  let total = 0; let included = 0;
  for (let i = 0; i < sizes.length; i++) {
    const sz = sizes[i];
    const eff = sz === null || sz > MAX_PART_BYTES ? MAX_PART_BYTES : sz; // tak diketahui/oversized: selalu sendirian dalam bagiannya
    if (included > 0 && total + eff > MAX_PART_BYTES) break;
    total += eff; included++;
    if (sz === null) unknown.push(paths[i]); else if (sz > MAX_PART_BYTES) oversized.push(paths[i]);
  }
  return { included, sizes: sizes.slice(0, included), oversized, unknown };
}

export type PartFileStat = { path: string; status: 'included' | 'missing' | 'error' | 'too_large'; bytes: number; sha256: string | null };

export async function* partEntries(s: StorageDeps, paths: string[], now: Date, plan: { oversized?: string[]; unknown?: string[] } = {}): AsyncGenerator<Entry> {
  const f = s.fetchImpl ?? fetch;
  const oversized = new Set(plan.oversized); const unknown = new Set(plan.unknown);
  const stats: PartFileStat[] = [];
  for (const path of paths) {
    if (oversized.has(path)) { stats.push({ path, status: 'too_large', bytes: 0, sha256: null }); continue; } // tidak diunduh; tercatat
    const res = await f(objUrl(s, path), { headers: ulanganAuthHeaders(s.key), cache: 'no-store', signal: AbortSignal.timeout(50_000) });
    if (!res.ok || !res.body) { stats.push({ path, status: res.status === 404 ? 'missing' : 'error', bytes: 0, sha256: null }); continue; }
    const declared = parseLength(res.headers.get('content-length'));
    if (declared !== null && declared > MAX_PART_BYTES) { await res.body.cancel().catch(() => {}); stats.push({ path, status: 'too_large', bytes: 0, sha256: null }); continue; }
    const body = res.body as unknown as AsyncIterable<Uint8Array>;
    if (unknown.has(path) && declared === null) {
      // Ukuran tak diketahui di kedua sisi: baca ke memori dengan plafon (sendirian dalam bagian ini) agar tak ada ZIP terpotong.
      const chunks: Buffer[] = []; let n = 0; let over = false;
      for await (const c of body) { n += c.length; if (n > MAX_PART_BYTES) { over = true; break; } chunks.push(Buffer.from(c)); }
      if (over) { await res.body.cancel().catch(() => {}); stats.push({ path, status: 'too_large', bytes: 0, sha256: null }); continue; }
      const data = Buffer.concat(chunks);
      stats.push({ path, status: 'included', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      yield { name: `files/${path}`, data };
      continue;
    }
    const stat: PartFileStat = { path, status: 'included', bytes: 0, sha256: null };
    const hash = createHash('sha256');
    yield { name: `files/${path}`, data: (async function* () { for await (const c of body) { hash.update(c); stat.bytes += c.length; yield Buffer.from(c); } stat.sha256 = hash.digest('hex'); })() };
    stats.push(stat);
  }
  yield { name: 'part-manifest.json', data: `${JSON.stringify({ format: 'teacher-workspace-backup-attachments', formatVersion: 1, exportedAt: now.toISOString(), files: stats }, null, 2)}\n` };
}
