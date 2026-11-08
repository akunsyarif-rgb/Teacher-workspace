import { NextRequest, NextResponse } from 'next/server';
import { restoreStudentServer } from '@/lib/server/classLifecycleService';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse, parseBody } from '@/lib/server/apiErrors';
import { StudentIdBodySchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';

// Pulihkan satu siswa dari Sampah. Izin (OWNER/ADMIN atau pembuatnya) dan batas kelas paket
// dicek di service dari teacher_profiles — bukan dari body.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { studentId } = parseBody(StudentIdBodySchema, await request.json().catch(() => ({})));
    return NextResponse.json(await restoreStudentServer(auth.uid, studentId));
  } catch (error) {
    return errorResponse(error, 'Gagal memulihkan siswa. Coba lagi.', 'student restore error');
  }
}
