import { NextRequest, NextResponse } from 'next/server';
import { deleteClassServer } from '@/lib/server/classLifecycleService';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse } from '@/lib/server/apiErrors';

export const runtime = 'nodejs';

// Khusus OWNER/ADMIN (dicek ulang di service dari teacher_profiles, bukan dari body).
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await deleteClassServer(auth.uid, body?.className));
  } catch (error) {
    return errorResponse(error, 'Gagal menghapus kelas. Coba lagi.', 'class delete error');
  }
}
