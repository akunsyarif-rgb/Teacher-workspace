import { NextRequest, NextResponse } from 'next/server';
import { renameClassServer } from '@/lib/server/classAdminService';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse } from '@/lib/server/apiErrors';

export const runtime = 'nodejs';
export const maxDuration = 60; // rename besar diproses bertahap; lihat renameClassServer

// Butuh Node.js runtime (firebase-admin) — bukan Edge. Rename className
// harus lewat Admin SDK karena juga menyentuh student_profiles yang
// rules-nya sengaja immutable dari client (lihat classAdminService.ts).
export async function POST(request: NextRequest) {
  // uid HARUS dari token yang diverifikasi, bukan dari body request —
  // supaya workspaceId ditentukan dari identitas asli pemanggil, tidak
  // bisa dipalsukan lewat body.
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const { oldName, newName } = body ?? {};
    if (!oldName || typeof oldName !== 'string' || !newName || typeof newName !== 'string') {
      return NextResponse.json({ error: 'Nama kelas lama dan baru diperlukan.' }, { status: 400 });
    }

    const result = await renameClassServer(auth.uid, oldName, newName);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'Gagal mengganti nama kelas.', 'class rename error');
  }
}
