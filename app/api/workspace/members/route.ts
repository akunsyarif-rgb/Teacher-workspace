import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';
import {
  WorkspaceAdminError,
  listWorkspaceMembersServer,
  removeWorkspaceMemberServer,
} from '@/lib/server/workspaceAdminService';

export const runtime = 'nodejs';

// Menu Admin: hanya OWNER (dicek ulang di workspaceAdminService.requireOwner).
async function authenticate(request: NextRequest): Promise<string | NextResponse> {
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return NextResponse.json({ error: 'Token otentikasi diperlukan.' }, { status: 401 });
  try {
    return (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: 'Sesi tidak valid. Silakan masuk kembali.' }, { status: 401 });
  }
}

function failure(error: unknown, fallback: string) {
  if (error instanceof WorkspaceAdminError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('workspace members error:', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const uid = await authenticate(request);
  if (uid instanceof NextResponse) return uid;
  try {
    return NextResponse.json(await listWorkspaceMembersServer(uid));
  } catch (error) {
    return failure(error, 'Gagal memuat daftar guru.');
  }
}

export async function DELETE(request: NextRequest) {
  const uid = await authenticate(request);
  if (uid instanceof NextResponse) return uid;
  try {
    const body = await request.json().catch(() => ({}));
    await removeWorkspaceMemberServer(uid, body?.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, 'Gagal mengeluarkan guru.');
  }
}
