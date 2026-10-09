export type OwnerWorkspace = {
  id: string;
  name: string;
  plan: string;
  seatLimit: number | null;
  classLimit: number | null;
  planExpiresAt: number | null;
  ownerUid: string;
  memberCount: number;
};

export type OwnerWorkspacePatch = {
  plan?: string;
  seatLimit?: number | null;
  classLimit?: number | null;
  planExpiresAt?: number | null;
};

async function ownerRequest(idToken: string, init: RequestInit, fallback: string) {
  const res = await fetch('/api/owner/workspaces', {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

// Panel pemilik aplikasi: idToken dari auth.currentUser; izin dicek di server.
export async function fetchOwnerWorkspaces(idToken: string): Promise<OwnerWorkspace[]> {
  const data = await ownerRequest(idToken, { method: 'GET' }, 'Gagal memuat workspace.');
  return data.workspaces;
}

export async function saveOwnerWorkspace(idToken: string, workspaceId: string, patch: OwnerWorkspacePatch) {
  await ownerRequest(idToken, { method: 'PATCH', body: JSON.stringify({ workspaceId, ...patch }) }, 'Gagal menyimpan perubahan.');
}
