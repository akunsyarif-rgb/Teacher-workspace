import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { serviceRequest, SupabaseServerError } from '@/lib/server/supabaseServer';
import { isUlanganEnabled } from '@/lib/config/ulangan';
import { AuthError, type IdentitySources } from '@/lib/server/ulanganAuth';
import { BadRequest, isAction, needsStudentIdentity, needsTeacher, runAction } from '@/lib/server/ulanganActions';

export const runtime = 'nodejs';

// Satu pintu server untuk Ulangan Harian (mengikuti pola route TW lain, mis. submission-attachments):
//   ID token Firebase diverifikasi → identitas guru/siswa & kelas dibaca dari Firestore → RPC Supabase (service_role).
// Klien tidak pernah berbicara langsung ke Supabase untuk ulangan. DEFAULT MATI (NEXT_PUBLIC_ULANGAN_ENABLED=yes).
// Body maks 256 KB; uid hanya dari token; aksi di luar daftar ditolak.
const MAX_BODY = 256 * 1024;

const src: IdentitySources = {
  async getDoc(collection, id) {
    const snap = await getAdminDb().collection(collection).doc(id).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  },
  async classExists(ws, className) {
    const snap = await getAdminDb().collection('students').where('workspaceId', '==', ws).where('className', '==', className).limit(1).get();
    return !snap.empty;
  },
  async listStudents(ws, classNames) {
    const out: { id: string; className: string; name: string }[] = [];
    for (const c of classNames) {
      const snap = await getAdminDb().collection('students').where('workspaceId', '==', ws).where('className', '==', c).get();
      for (const d of snap.docs) out.push({ id: d.id, className: c, name: String(d.get('name') ?? '') });
    }
    return out;
  },
};

const rpc = (name: string, args: Record<string, unknown>) => serviceRequest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

// Kode galat basis data (raise exception ... errcode) → status HTTP; pesan = kode yang dipetakan klien ke bahasa pengguna.
function dbError(e: SupabaseServerError) {
  const code = e.code ?? '';
  const message = e.message.slice(0, 80).replace(/[^a-z0-9_ ]/gi, '');
  if (code === '42501') return NextResponse.json({ error: message || 'forbidden' }, { status: 403 });
  if (code === 'P0001') return NextResponse.json({ error: message }, { status: 409 });
  if (code === '22023' || code === '22P02') return NextResponse.json({ error: message || 'invalid_request' }, { status: 400 });
  console.error('ulangan rpc gagal:', e.status, code, e.message);
  return NextResponse.json({ error: 'server_error' }, { status: 502 });
}

export async function POST(request: NextRequest) {
  if (!isUlanganEnabled()) return NextResponse.json({ error: 'Fitur belum diaktifkan.' }, { status: 501 });
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return NextResponse.json({ error: 'Permintaan terlalu besar.' }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return NextResponse.json({ error: 'Permintaan terlalu besar.' }, { status: 413 });
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bukan objek');
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const action = body.action;
  if (!isAction(action)) return NextResponse.json({ error: 'unknown_action' }, { status: 400 });

  let uid: string;
  try {
    // Aksi yang menentukan hak (guru, daftar/mulai siswa) memeriksa pencabutan sesi; autosave/submit cukup tanda tangan + masa berlaku.
    uid = (await getAdminAuth().verifyIdToken(idToken, needsTeacher(action) || needsStudentIdentity(action))).uid;
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid. Masuk kembali lalu coba lagi.' }, { status: 401 });
  }

  try {
    return NextResponse.json({ data: await runAction(action, uid, body, { rpc, src }) ?? null });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof SupabaseServerError) return dbError(e);
    console.error('ulangan gagal:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
