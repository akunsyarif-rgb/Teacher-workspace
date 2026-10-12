import { createHash } from 'node:crypto';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ulanganAuthHeaders } from '@/lib/server/ulanganSupabase';
import { refsFrom, type Entry } from './exportWorkspace';
import type { Actor } from './inventory';

// Lampiran pengumpulan tugas (Supabase Storage, bucket privat) diunduh dalam BAGIAN-bagian kecil agar tiap permintaan terbatas
// waktu/memorinya. Isolasi workspace: HANYA path berawalan submissions/<workspaceId>/ (sama seperti route sign lampiran).
export const BUCKET = 'submission-attachments';
export const MAX_PATHS_PER_PART = 30;
export const MAX_PART_BYTES = 40 * 1024 * 1024;
const MAX_PATH_LEN = 400;

export type PlanFile = { path: string; name: string | null; assignmentId: string | null; studentId: string | null; className: string | null };
export type StorageDeps = { url: string; key: string; fetchImpl?: typeof fetch };

export async function planAttachments(db: Firestore, actor: Actor): Promise<PlanFile[]> {
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

/** Tentukan berapa path (awalan daftar) yang muat dalam satu bagian, lewat HEAD ukuran. Minimal 1. */
export async function probePart(s: StorageDeps, paths: string[]): Promise<{ included: number; sizes: number[] }> {
  const f = s.fetchImpl ?? fetch;
  const sizes = await Promise.all(paths.map(async (p) => {
    const r = await f(objUrl(s, p), { method: 'HEAD', headers: ulanganAuthHeaders(s.key), cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    return r.ok ? Number(r.headers.get('content-length') ?? 0) || 0 : 0;
  }));
  let total = 0; let included = 0;
  for (const sz of sizes) { if (included > 0 && total + sz > MAX_PART_BYTES) break; total += sz; included++; }
  return { included, sizes };
}

export type PartFileStat = { path: string; status: 'included' | 'missing' | 'error'; bytes: number; sha256: string | null };

export async function* partEntries(s: StorageDeps, paths: string[], now: Date): AsyncGenerator<Entry> {
  const f = s.fetchImpl ?? fetch;
  const stats: PartFileStat[] = [];
  for (const path of paths) {
    const res = await f(objUrl(s, path), { headers: ulanganAuthHeaders(s.key), cache: 'no-store', signal: AbortSignal.timeout(50_000) });
    if (!res.ok || !res.body) { stats.push({ path, status: res.status === 404 ? 'missing' : 'error', bytes: 0, sha256: null }); continue; }
    const stat: PartFileStat = { path, status: 'included', bytes: 0, sha256: null };
    const hash = createHash('sha256');
    const body = res.body as unknown as AsyncIterable<Uint8Array>;
    yield { name: `files/${path}`, data: (async function* () { for await (const c of body) { hash.update(c); stat.bytes += c.length; yield Buffer.from(c); } stat.sha256 = hash.digest('hex'); })() };
    stats.push(stat);
  }
  yield { name: 'part-manifest.json', data: `${JSON.stringify({ format: 'teacher-workspace-backup-attachments', formatVersion: 1, exportedAt: now.toISOString(), files: stats }, null, 2)}\n` };
}
