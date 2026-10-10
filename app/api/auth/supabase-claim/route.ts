import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

// Memasang claim `role: "authenticated"` pada akun Firebase pemanggil agar token-nya diterima Supabase (Third-Party Auth).
// - DEFAULT MATI: baru aktif bila env server ENABLE_SUPABASE_CLAIM=yes (set dulu di Preview untuk validasi).
// - uid HANYA dari ID token yang diverifikasi; claim yang dipasang tetap/tidak bisa dipilih klien; claim lain dipertahankan.
// - `authenticated` bukan hak istimewa: akses data tetap ditentukan RLS (workspace/peran). Berlaku guru DAN siswa anonim.
export async function POST(request: NextRequest) {
  if (process.env.ENABLE_SUPABASE_CLAIM !== 'yes') {
    return NextResponse.json({ error: 'Fitur belum diaktifkan.' }, { status: 501 });
  }
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.role === 'authenticated') return NextResponse.json({ ok: true, alreadySet: true });

    const user = await auth.getUser(decoded.uid);
    await auth.setCustomUserClaims(decoded.uid, { ...(user.customClaims ?? {}), role: 'authenticated' });
    return NextResponse.json({ ok: true, alreadySet: false });
  } catch (error) {
    console.error('supabase-claim error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Sesi tidak valid atau gagal memasang claim.' }, { status: 401 });
  }
}
