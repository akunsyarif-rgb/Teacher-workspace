import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/requireAuth';
import { logger } from '@/lib/utils/logger';
import {
  OwnerPanelError,
  listWorkspacesForOwnerServer,
  updateWorkspaceForOwnerServer,
} from '@/lib/server/ownerAdminService';

export const runtime = 'nodejs';

// Panel pemilik aplikasi. Izin dicek ulang di server lewat env APP_OWNER_UIDS.
async function authenticate(request: NextRequest): Promise<string | NextResponse> {
  const auth = await requireAuth(request);
  return auth instanceof NextResponse ? auth : auth.uid;
}

function failure(error: unknown, fallback: string) {
  if (error instanceof OwnerPanelError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  logger.error('owner_panel.failed', { err: error });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const uid = await authenticate(request);
  if (uid instanceof NextResponse) return uid;
  try {
    return NextResponse.json({ workspaces: await listWorkspacesForOwnerServer(uid) });
  } catch (error) {
    return failure(error, 'Gagal memuat workspace.');
  }
}

export async function PATCH(request: NextRequest) {
  const uid = await authenticate(request);
  if (uid instanceof NextResponse) return uid;
  try {
    const body = await request.json().catch(() => ({}));
    const { workspaceId, ...patch } = body ?? {};
    await updateWorkspaceForOwnerServer(uid, workspaceId, patch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, 'Gagal menyimpan perubahan.');
  }
}
