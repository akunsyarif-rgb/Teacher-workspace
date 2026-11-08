import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { createPaymentTransaction } from '@/lib/server/paymentService';
import { isPaidPlan } from '@/lib/config/plans';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse } from '@/lib/server/apiErrors';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { uid, token } = auth;

  try {
    const body = await request.json().catch(() => ({}));
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
      customerEmail: token.email,
      customerName: (token.name as string | undefined) || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    // Konfigurasi Midtrans / error SDK tidak boleh bocor ke client (hanya ApiError validasi yang tampil).
    return errorResponse(error, 'Gagal membuat transaksi pembayaran. Coba lagi.', 'create-transaction error');
  }
}
