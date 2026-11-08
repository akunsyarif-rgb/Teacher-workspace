import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/requireAuth';
import { logger } from '@/lib/utils/logger';
import {
  WorkspaceAdminError,
  listWorkspaceMembersServer,
  removeWorkspaceMemberServer,
} from '@/lib/server/workspaceAdminService';

export const runtime = 'nodejs';

// Menu Admin: hanya OWNER (dicek ulang di workspaceAdminService.requireOwner).
async function authenticate(request: NextRequest): Promise<string | NextResponse> {
  const auth = await requireAuth(request);
  return auth instanceof NextResponse ? auth : auth.uid;
}

function failure(error: unknown, fallback: string) {
  if (error instanceof WorkspaceAdminError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  logger.error('workspace_members.failed', { err: error });
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
