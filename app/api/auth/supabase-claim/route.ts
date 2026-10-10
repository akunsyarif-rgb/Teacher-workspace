import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';
import { describeClaimFlag, isClaimEnabled } from '@/lib/server/claimFlag';

export const runtime = 'nodejs';

// Memasang claim `role: "authenticated"` pada akun Firebase pemanggil agar token-nya diterima Supabase (Third-Party Auth).
// - DEFAULT MATI: baru aktif bila env server ENABLE_SUPABASE_CLAIM=yes (dibaca saat request; set dulu di Preview untuk validasi).
// - uid HANYA dari ID token yang diverifikasi; claim yang dipasang tetap/tidak bisa dipilih klien; claim lain dipertahankan.
// - `authenticated` bukan hak istimewa: akses data tetap ditentukan RLS (workspace/peran). Berlaku guru DAN siswa anonim.
export async function POST(request: NextRequest) {
  if (!isClaimEnabled(process.env.ENABLE_SUPABASE_CLAIM)) {
    // Diagnostik non-rahasia (tanpa nilai env); di Production hanya pesan minimal. Lihat lib/server/claimFlag.ts.
    return NextResponse.json(describeClaimFlag(), { status: 501 });
  }
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });

  const auth = getAdminAuth();
  let uid: string;
  let alreadySet = false;
  try {
    // checkRevoked=true: akun yang dinonaktifkan/dicabut sesinya tidak boleh mendapat claim baru.
    const decoded = await auth.verifyIdToken(idToken, true);
    uid = decoded.uid;
    alreadySet = decoded.role === 'authenticated';
  } catch (error) {
    console.error('supabase-claim verifikasi token gagal:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Sesi tidak valid. Masuk kembali lalu coba lagi.' }, { status: 401 });
  }
  if (alreadySet) return NextResponse.json({ ok: true, alreadySet: true });

  try {
    const user = await auth.getUser(uid);
    await auth.setCustomUserClaims(uid, { ...(user.customClaims ?? {}), role: 'authenticated' });
    return NextResponse.json({ ok: true, alreadySet: false });
  } catch (error) {
    // Kegagalan di sini BUKAN soal token: biasanya service account tidak punya izin mengubah pengguna Firebase Auth.
    console.error('supabase-claim gagal memasang claim:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Server gagal memasang claim. Periksa izin service account (peran Firebase Authentication Admin) dan log Vercel.' },
      { status: 500 }
    );
  }
}
