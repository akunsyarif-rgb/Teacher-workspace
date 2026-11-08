import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse } from '@/lib/server/apiErrors';
import { createStudentsServer } from '@/lib/server/studentAdminService';

export const runtime = 'nodejs';

// Satu-satunya jalur membuat siswa (firestore.rules menutup create langsung).
// Batas kelas paket + masa berlaku paket dicek di createStudentsServer.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const students = await createStudentsServer(auth.uid, body?.students);
    return NextResponse.json({ students });
  } catch (error) {
    return errorResponse(error, 'Gagal menambahkan siswa. Coba lagi.', 'students create error');
  }
}
