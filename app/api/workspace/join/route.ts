import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { joinWorkspaceByCodeServer } from '@/lib/server/workspaceAdminService';
import { checkRateLimits, clientIp, recordFailures, type RateRule } from '@/lib/server/rateLimit';
import { requireAuth } from '@/lib/server/requireAuth';
import { ApiError, errorResponse } from '@/lib/server/apiErrors';

export const runtime = 'nodejs';

// Batas percobaan GAGAL join (kode salah/kedaluwarsa/kuota penuh) — anti tebak kode undangan.
const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES_PER_UID = 6;
const MAX_FAILURES_PER_IP = 30;

// Butuh Node.js runtime (firebase-admin bergantung pada modul Node) —
// bukan Edge. Sama seperti app/api/payments/create-transaction/route.ts.
export async function POST(request: NextRequest) {
  // uid HARUS dari token yang diverifikasi, bukan dari body request —
  // supaya tidak ada yang bisa "join" mengatasnamakan akun orang lain.
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { uid } = auth;

  try {
    const rules: RateRule[] = [
      { key: `workspace-join:uid:${uid}`, limit: MAX_FAILURES_PER_UID, windowSeconds: WINDOW_SECONDS },
      { key: `workspace-join:ip:${clientIp(request)}`, limit: MAX_FAILURES_PER_IP, windowSeconds: WINDOW_SECONDS },
    ];
    const db = getAdminDb();
    const limited = await checkRateLimits(db, rules);
    if (!limited.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(limited.retryAfterSeconds / 60)} menit.` },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { inviteCode } = body ?? {};
    if (!inviteCode || typeof inviteCode !== 'string') {
      return NextResponse.json({ error: 'Kode undangan diperlukan.' }, { status: 400 });
    }

    try {
      const workspace = await joinWorkspaceByCodeServer(uid, inviteCode);
      return NextResponse.json({ workspace });
    } catch (error) {
      // Hanya penolakan yang disengaja (kode salah, kedaluwarsa, penuh) yang dihitung tebakan.
      if (error instanceof ApiError) {
        await recordFailures(db, rules).catch((e) => console.error('rate limit record gagal:', e));
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error, 'Gagal bergabung ke workspace. Coba lagi.', 'workspace join error');
  }
}
