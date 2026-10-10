import { isSupabaseCollection } from '../config/dataBackend';
import { SUPABASE_MAPPED_COLLECTIONS } from '../adapters/supabaseAdapter';

// Rename kelas harus mengikuti koleksi yang sudah dialihkan ke Supabase: renameClassServer hanya
// mengubah Firestore, sehingga baris Supabase akan tertinggal dengan nama kelas lama (dan siswa
// kehilangan akses lewat RLS yang mencocokkan class_name). Dijalankan server-side dengan secret key
// (service_role) dan SELALU dibatasi workspace_id + class_name lama; satu PATCH atomik per tabel.
// Koleksi yang tidak punya kolom class_name (academic_years) otomatis dilewati.
const NO_CLASS_COLUMN = new Set(['academic_years']);

export function supabaseCollectionsToRename(flag?: string, override?: string, studentAuth?: string) {
  return SUPABASE_MAPPED_COLLECTIONS.filter((c) => !NO_CLASS_COLUMN.has(c) && isSupabaseCollection(c, flag, override, studentAuth));
}

function supabaseEnv(url?: string, key?: string) {
  const u = (url ?? process.env.SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const k = key ?? process.env.SUPABASE_SECRET_KEY;
  if (!u || !k) throw new Error('Konfigurasi Supabase server belum lengkap: pemeriksaan/rename kelas pada koleksi Supabase tidak bisa dijalankan.');
  return { u, k };
}

/** Apakah kelas sudah ada di tabel students Supabase? `null` bila students belum dialihkan (pakai Firestore). */
export async function supabaseClassExists(opts: {
  workspaceId: string; className: string; flagged?: boolean; url?: string; secretKey?: string; fetchImpl?: typeof fetch;
}): Promise<boolean | null> {
  const flagged = opts.flagged ?? supabaseCollectionsToRename(
    process.env.NEXT_PUBLIC_SUPABASE_COLLECTIONS, process.env.NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE, process.env.NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED).includes('students');
  if (!flagged) return null;
  const { u, k } = supabaseEnv(opts.url, opts.secretKey);
  const res = await (opts.fetchImpl ?? fetch)(
    `${u}/rest/v1/students?workspace_id=eq.${encodeURIComponent(opts.workspaceId)}&class_name=eq.${encodeURIComponent(opts.className)}&select=id&limit=1`,
    { headers: { apikey: k, Authorization: `Bearer ${k}` } }
  );
  if (!res.ok) throw new Error(`Pemeriksaan kelas di Supabase gagal (HTTP ${res.status}).`);
  const text = await res.text();
  return (text ? (JSON.parse(text) as unknown[]) : []).length > 0;
}

export interface RenameInSupabaseOptions {
  workspaceId: string;
  oldName: string;
  newName: string;
  collections?: string[];
  url?: string;
  secretKey?: string;
  fetchImpl?: typeof fetch;
}

export async function renameClassInSupabase(opts: RenameInSupabaseOptions) {
  const collections = opts.collections ?? supabaseCollectionsToRename(
    process.env.NEXT_PUBLIC_SUPABASE_COLLECTIONS, process.env.NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE, process.env.NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED);
  if (collections.length === 0) return {} as Record<string, number>;
  const { u: url, k: key } = supabaseEnv(opts.url, opts.secretKey);
  const doFetch = opts.fetchImpl ?? fetch;

  const done: Record<string, number> = {};
  for (const c of collections) {
    const res = await doFetch(
      `${url}/rest/v1/${c}?workspace_id=eq.${encodeURIComponent(opts.workspaceId)}&class_name=eq.${encodeURIComponent(opts.oldName)}`,
      {
        method: 'PATCH',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ class_name: opts.newName }),
      }
    );
    if (!res.ok) {
      const sudah = Object.entries(done).map(([k, n]) => `${k}:${n}`).join(', ') || 'belum ada';
      throw new Error(`Rename kelas di Supabase gagal pada ${c} (HTTP ${res.status}). Sudah berubah: ${sudah}. Periksa konsistensi sebelum mengulang.`);
    }
    const text = await res.text();
    const body = (text ? JSON.parse(text) : []) as unknown[];
    done[c] = Array.isArray(body) ? body.length : 0;
  }
  return done;
}
