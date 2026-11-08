import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';
import { StudentAdminError, createStudentsServer } from '@/lib/server/studentAdminService';

export const runtime = 'nodejs';

// Satu-satunya jalur membuat siswa (firestore.rules menutup create langsung).
// Batas kelas paket + masa berlaku paket dicek di createStudentsServer.
export async function POST(request: NextRequest) {
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid. Silakan masuk kembali.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const students = await createStudentsServer(uid, body?.students);
    return NextResponse.json({ students });
  } catch (error) {
    if (error instanceof StudentAdminError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('students create error:', error);
    return NextResponse.json({ error: 'Gagal menambahkan siswa. Coba lagi.' }, { status: 500 });
  }
}
