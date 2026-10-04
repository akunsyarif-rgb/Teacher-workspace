import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const idToken = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) {
      return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const user = await adminAuth.getUser(decoded.uid);
    const currentClaims = user.customClaims ?? {};

    if (currentClaims.role !== 'authenticated') {
      await adminAuth.setCustomUserClaims(decoded.uid, {
        ...currentClaims,
        role: 'authenticated',
      });
    }

    return NextResponse.json({
      ok: true,
      uid: decoded.uid,
      refreshRequired: currentClaims.role !== 'authenticated',
    });
  } catch (error: any) {
    console.error('Supabase identity bridge error:', error);
    return NextResponse.json(
      { error: error?.message || 'Gagal menyinkronkan identitas.' },
      { status: 401 },
    );
  }
}
