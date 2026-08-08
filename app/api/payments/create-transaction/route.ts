import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { createPaymentTransaction } from '@/lib/server/paymentService';
import { isPaidPlan } from '@/lib/config/plans';

export const runtime = 'nodejs';

// Butuh Node.js runtime (firebase-admin & midtrans-client bergantung pada
// modul Node seperti crypto) — bukan Edge.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) {
      return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
    }

    // Verifikasi ID token Firebase Auth — uid HARUS berasal dari sini,
    // bukan dari body request, supaya tidak bisa dipalsukan.
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const body = await request.json();
    const { workspaceId, plan, seatCount } = body ?? {};

    if (!workspaceId || typeof workspaceId !== 'string' || !isPaidPlan(plan)) {
      return NextResponse.json({ error: 'workspaceId dan plan yang valid diperlukan.' }, { status: 400 });
    }

    const adminDb = getAdminDb();
    const workspaceSnap = await adminDb.collection('workspaces').doc(workspaceId).get();
    if (!workspaceSnap.exists) {
      return NextResponse.json({ error: 'Workspace tidak ditemukan.' }, { status: 404 });
    }
    const workspace = workspaceSnap.data() as { ownerUid?: string };
    if (workspace.ownerUid !== uid) {
      return NextResponse.json({ error: 'Hanya pemilik workspace yang boleh melakukan upgrade paket.' }, { status: 403 });
    }

    const result = await createPaymentTransaction({
      workspaceId,
      uid,
      plan,
      seatCount,
      customerEmail: decoded.email,
      customerName: (decoded.name as string | undefined) || undefined,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('create-transaction error:', error);
    return NextResponse.json({ error: error.message || 'Gagal membuat transaksi pembayaran.' }, { status: 500 });
  }
}
