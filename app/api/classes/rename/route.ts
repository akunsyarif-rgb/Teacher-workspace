import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';
import { renameClassServer } from '@/lib/server/classAdminService';

export const runtime = 'nodejs';

// Butuh Node.js runtime (firebase-admin) — bukan Edge. Rename className
// harus lewat Admin SDK karena juga menyentuh student_profiles yang
// rules-nya sengaja immutable dari client (lihat classAdminService.ts).
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!idToken) {
      return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
    }

    // uid HARUS dari token yang diverifikasi, bukan dari body request —
    // supaya workspaceId ditentukan dari identitas asli pemanggil, tidak
    // bisa dipalsukan lewat body.
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const body = await request.json();
    const { oldName, newName } = body ?? {};
    if (!oldName || typeof oldName !== 'string' || !newName || typeof newName !== 'string') {
      return NextResponse.json({ error: 'Nama kelas lama dan baru diperlukan.' }, { status: 400 });
    }

    const result = await renameClassServer(uid, oldName, newName);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('class rename error:', error);
    return NextResponse.json({ error: error.message || 'Gagal mengganti nama kelas.' }, { status: 400 });
  }
}
