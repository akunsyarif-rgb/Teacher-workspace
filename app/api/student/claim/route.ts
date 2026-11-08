import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse } from '@/lib/server/apiErrors';
import { ClaimError, claimStudentAccessCodeServer } from '@/lib/server/studentClaimService';
import { checkRateLimits, clientIp, recordFailures, type RateRule } from '@/lib/server/rateLimit';

export const runtime = 'nodejs';

// Batas percobaan GAGAL (kode salah/tidak dikenal). Per uid ketat; per IP
// lebih longgar karena satu kelas bisa berbagi IP sekolah.
const WINDOW_SECONDS = 10 * 60;
const MAX_FAILURES_PER_UID = 8;
const MAX_FAILURES_PER_IP = 40;

// Satu-satunya jalur klaim kode akses siswa (firestore.rules menutup baca
// student_login_codes dan create student_profiles dari client).
export async function POST(request: NextRequest) {
  // Token siswa anonim: tetap diperiksa pencabutannya (default requireAuth).
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { uid } = auth;

  const rules: RateRule[] = [
    { key: `student-claim:uid:${uid}`, limit: MAX_FAILURES_PER_UID, windowSeconds: WINDOW_SECONDS },
    { key: `student-claim:ip:${clientIp(request)}`, limit: MAX_FAILURES_PER_IP, windowSeconds: WINDOW_SECONDS },
  ];

  try {
    const db = getAdminDb();
    const limited = await checkRateLimits(db, rules);
    if (!limited.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak percobaan salah. Coba lagi dalam ${Math.ceil(limited.retryAfterSeconds / 60)} menit.` },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    try {
      const profile = await claimStudentAccessCodeServer(uid, body?.accessCode, db);
      return NextResponse.json({ profile });
    } catch (error) {
      if (error instanceof ClaimError) {
        if (error.countsAsFailure) await recordFailures(db, rules).catch((e) => console.error('rate limit record gagal:', e));
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error, 'Gagal masuk. Coba lagi beberapa saat lagi.', 'student claim error');
  }
}
