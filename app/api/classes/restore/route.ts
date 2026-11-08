import { NextRequest, NextResponse } from 'next/server';
import { restoreClassServer } from '@/lib/server/classLifecycleService';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse, parseBody } from '@/lib/server/apiErrors';
import { ClassNameBodySchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';

// Khusus OWNER/ADMIN (dicek ulang di service dari teacher_profiles, bukan dari body).
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { className } = parseBody(ClassNameBodySchema, await request.json().catch(() => ({})));
    return NextResponse.json(await restoreClassServer(auth.uid, className));
  } catch (error) {
    return errorResponse(error, 'Gagal memulihkan kelas. Coba lagi.', 'class restore error');
  }
}
