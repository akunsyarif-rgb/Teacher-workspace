import { NextRequest, NextResponse } from 'next/server';
import { purgeAllServer, purgeItemServer } from '@/lib/server/trashPurgeService';
import { requireAuth } from '@/lib/server/requireAuth';
import { errorResponse, parseBody } from '@/lib/server/apiErrors';
import { PurgeBodySchema } from '@/lib/schemas/api';

export const runtime = 'nodejs';
export const maxDuration = 60; // pekerjaan besar diproses bertahap: lihat purgeItemServer/purgeAllServer

// Hapus PERMANEN dari Sampah — khusus OWNER/ADMIN (dicek ulang di service dari teacher_profiles, bukan dari body).
// Hanya item yang sudah di Sampah yang bisa dihapus. Respons `done:false` = belum tuntas, panggil lagi.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = parseBody(PurgeBodySchema, await request.json().catch(() => ({})));
    const result = 'all' in body ? await purgeAllServer(auth.uid) : await purgeItemServer(auth.uid, body);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'Gagal menghapus permanen. Coba lagi.', 'trash purge error');
  }
}
