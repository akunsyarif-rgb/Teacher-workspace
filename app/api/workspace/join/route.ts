import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';
import { joinWorkspaceByCodeServer } from '@/lib/server/workspaceAdminService';

export const runtime = 'nodejs';

// Butuh Node.js runtime (firebase-admin bergantung pada modul Node) —
// bukan Edge. Sama seperti app/api/payments/create-transaction/route.ts.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) {
      return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
    }

    // uid HARUS dari token yang diverifikasi, bukan dari body request —
    // supaya tidak ada yang bisa "join" mengatasnamakan akun orang lain.
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const body = await request.json();
    const { inviteCode } = body ?? {};
    if (!inviteCode || typeof inviteCode !== 'string') {
      return NextResponse.json({ error: 'Kode undangan diperlukan.' }, { status: 400 });
    }

    const workspace = await joinWorkspaceByCodeServer(uid, inviteCode);
    return NextResponse.json({ workspace });
  } catch (error: any) {
    console.error('workspace join error:', error);
    return NextResponse.json({ error: error.message || 'Gagal bergabung ke workspace.' }, { status: 400 });
  }
}
