import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

/**
 * Phase 3 diagnostic only.
 * Verifies the Firebase -> Supabase JWT bridge and a harmless RLS read.
 * It does not mutate any application data.
 */
export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const idToken = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) {
      return NextResponse.json({ ok: false, error: 'Token otentikasi diperlukan.' }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!baseUrl || !publishableKey) {
      return NextResponse.json(
        { ok: false, error: 'Konfigurasi Supabase belum tersedia di environment aplikasi.' },
        { status: 503 },
      );
    }

    const url = new URL('/rest/v1/teacher_profiles', baseUrl);
    url.searchParams.set('user_id', `eq.${decoded.uid}`);
    url.searchParams.set('select', 'user_id,workspace_id,role');
    url.searchParams.set('limit', '1');

    const response = await fetch(url, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${idToken}`,
      },
      cache: 'no-store',
    });

    const body = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, firebaseUid: decoded.uid, supabaseStatus: response.status, error: body },
        { status: 502 },
      );
    }

    let rows: unknown = [];
    try {
      rows = JSON.parse(body);
    } catch {
      rows = [];
    }

    return NextResponse.json({
      ok: true,
      firebaseUid: decoded.uid,
      supabaseReachable: true,
      rlsRead: true,
      profileFound: Array.isArray(rows) && rows.length > 0,
    });
  } catch (error: any) {
    console.error('Supabase health check failed:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Supabase health check gagal.' },
      { status: 500 },
    );
  }
}
