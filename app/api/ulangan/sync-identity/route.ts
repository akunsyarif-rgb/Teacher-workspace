import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { isClaimEnabled } from '@/lib/server/claimFlag';
import { serviceRequest } from '@/lib/server/supabaseServer';
import { syncUlanganIdentity, type IdentitySources } from '@/lib/server/ulanganIdentitySync';
import { createIdentitySink } from '@/lib/server/ulanganIdentitySink';
import { createLimiter } from '@/lib/server/ulanganRateLimit';
import { checkDurable } from '@/lib/server/ulanganDurableLimit';

export const runtime = 'nodejs';

// Memproyeksikan identitas pemanggil (guru/siswa) dari Firestore ke Supabase untuk modul Ulangan Harian.
// - DEFAULT MATI: aktif hanya bila env server ENABLE_ULANGAN_IDENTITY_SYNC=yes (set dulu di Preview).
// - uid HANYA dari ID token terverifikasi (checkRevoked); body hanya boleh membawa {roster:boolean} (maks 1 KB).
// - Urutan: tanda tangan token (murah) → pembatas in-memory (per instance) → pembatas DURABLE lintas-instance di database →
//   cek pencabutan token (panggilan jaringan) → baca Firestore → tulis. Banjir permintaan tidak memicu panggilan jaringan mahal.
// - Menulis ke Supabase dengan SUPABASE_SECRET_KEY lewat sink yang hanya mengizinkan ulh_members/ulh_roster. Kunci tidak pernah ke klien.
// - Pembatas in-memory hanyalah lapis pertama per instance. Batas lintas-instance ditegakkan oleh ulh_rate_hit (jendela tetap, fail-closed);
//   pagar jaringan (Vercel Firewall / Firebase App Check) tetap perlu dan dicatat di docs/ULANGAN-HARIAN.md.
const checkIdentity = createLimiter({ perKeyMs: 5_000, globalMax: 1_500, windowMs: 60_000 });
const checkRoster = createLimiter({ perKeyMs: 15_000, globalMax: 300, windowMs: 60_000 });
const MAX_BODY_BYTES = 1024;

const sources: IdentitySources = {
  async getDoc(collection, id) {
    const snap = await getAdminDb().collection(collection).doc(id).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  },
  async listStudents(workspaceId) {
    const snap = await getAdminDb().collection('students').where('workspaceId', '==', workspaceId).get();
    return snap.docs.map((d) => ({ id: d.id, className: String(d.get('className') ?? '').trim(), name: String(d.get('name') ?? '') }));
  },
};
const sink = createIdentitySink((path, init) => serviceRequest(path, init));

const tooMany = (retryAfterSec: number) =>
  NextResponse.json({ error: 'Terlalu sering. Coba lagi sebentar.' }, { status: 429, headers: { 'Retry-After': String(retryAfterSec) } });

export async function POST(request: NextRequest) {
  if (!isClaimEnabled(process.env.ENABLE_ULANGAN_IDENTITY_SYNC)) {
    return NextResponse.json({ error: 'Fitur belum diaktifkan.' }, { status: 501 });
  }
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Permintaan terlalu besar.' }, { status: 413 });
  }

  const auth = getAdminAuth();
  let uid: string;
  try {
    uid = (await auth.verifyIdToken(idToken, false)).uid; // tanda tangan saja: tanpa panggilan jaringan
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid. Masuk kembali lalu coba lagi.' }, { status: 401 });
  }

  let wantRoster = false;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Permintaan terlalu besar.' }, { status: 413 });
    wantRoster = text ? JSON.parse(text)?.roster === true : false;
  } catch { /* body bukan JSON: perlakukan sebagai tanpa roster */ }

  const base = checkIdentity(uid);
  if (!base.ok) return tooMany(base.retryAfterSec);
  if (wantRoster) {
    const r = checkRoster(uid);
    if (!r.ok) wantRoster = false; // sinkronisasi identitas tetap jalan; roster ditunda
  }

  const durable = await checkDurable(uid, (path, init) => serviceRequest(path, init));
  if (!durable.ok) {
    return durable.reason === 'limited'
      ? tooMany(10)
      : NextResponse.json({ error: 'Layanan sementara tidak tersedia.' }, { status: 503, headers: { 'Retry-After': '30' } });
  }

  try {
    await auth.verifyIdToken(idToken, true); // akun dinonaktifkan / sesi dicabut tidak mendapat proyeksi baru
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid. Masuk kembali lalu coba lagi.' }, { status: 401 });
  }

  try {
    const result = await syncUlanganIdentity({ uid, roster: wantRoster }, sources, sink);
    return NextResponse.json({ ok: true, kind: result.kind });
  } catch (error) {
    console.error('ulangan sync-identity gagal:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Sinkronisasi identitas gagal.' }, { status: 502 });
  }
}
