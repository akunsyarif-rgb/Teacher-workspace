import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { isClaimEnabled } from '@/lib/server/claimFlag';
import { serviceRequest } from '@/lib/server/supabaseServer';
import { syncUlanganIdentity, type IdentitySink, type IdentitySources } from '@/lib/server/ulanganIdentitySync';

export const runtime = 'nodejs';

// Memproyeksikan identitas pemanggil (guru/siswa) dari Firestore ke Supabase untuk modul Ulangan Harian.
// - DEFAULT MATI: aktif hanya bila env server ENABLE_ULANGAN_IDENTITY_SYNC=yes (set dulu di Preview).
// - uid HANYA dari ID token terverifikasi (checkRevoked); body hanya boleh membawa {roster:boolean}.
// - Menulis ke Supabase dengan SUPABASE_SECRET_KEY (server) — tidak pernah ke klien. Tidak menyentuh data produksi lain.
const lastRoster = new Map<string, number>(); // pembatas laju best-effort per instance
const ROSTER_MIN_INTERVAL_MS = 15_000;

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

const sink: IdentitySink = {
  async upsert(table, rows, onConflict) {
    await serviceRequest(`${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
  },
  async remove(table, filter) {
    await serviceRequest(`${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  },
};

export async function POST(request: NextRequest) {
  if (!isClaimEnabled(process.env.ENABLE_ULANGAN_IDENTITY_SYNC)) {
    return NextResponse.json({ error: 'Fitur belum diaktifkan.' }, { status: 501 });
  }
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken, true)).uid;
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid. Masuk kembali lalu coba lagi.' }, { status: 401 });
  }

  let wantRoster = false;
  try { wantRoster = (await request.json())?.roster === true; } catch { /* tanpa body */ }
  const now = Date.now();
  if (wantRoster && now - (lastRoster.get(uid) ?? 0) < ROSTER_MIN_INTERVAL_MS) wantRoster = false;

  try {
    const result = await syncUlanganIdentity({ uid, roster: wantRoster }, sources, sink);
    if (wantRoster) lastRoster.set(uid, now);
    return NextResponse.json({ ok: true, kind: result.kind });
  } catch (error) {
    console.error('ulangan sync-identity gagal:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Sinkronisasi identitas gagal.' }, { status: 502 });
  }
}
