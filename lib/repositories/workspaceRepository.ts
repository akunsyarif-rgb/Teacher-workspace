import {
  getDocument,
  setDocument,
  updateDocument,
  generateId,
  serverTimestamp,
} from '../adapters/firestoreAdapter';
import type { WorkspacePlan } from '../config/plans';

const WORKSPACES_COLLECTION = 'workspaces';
const WORKSPACE_INVITES_COLLECTION = 'workspace_invites';

export type { WorkspacePlan };

export type WorkspaceDoc = {
  name: string;
  plan: WorkspacePlan;
  ownerUid: string;
  classLimit: number | null; // null = tak terbatas
  seatLimit?: number | null; // khusus school_annual — batas jumlah guru (termasuk owner). null/tidak ada = tak terbatas.
  planExpiresAt?: number | null; // epoch ms — khusus paket berlangganan (individual_monthly, school_annual). null/tidak ada = tidak pernah kedaluwarsa.
  inviteCode?: string;
  inviteCodeExpiresAt?: number; // epoch ms
  createdAt?: any;
  updatedAt?: any;
};

// Jembatan kode undangan -> workspaceId (audit T2). Dipisah dari dokumen
// workspaces itu sendiri karena guru yang belum bergabung tidak boleh
// query collection workspaces sama sekali (lihat firestore.rules) —
// tapi BOLEH `get` satu dokumen di sini kalau sudah tahu kodenya persis,
// sama seperti alur student_login_codes.
async function writeInviteBridge(workspaceId: string, inviteCode: string, expiresAt: number) {
  await setDocument(WORKSPACE_INVITES_COLLECTION, inviteCode, {
    workspaceId,
    expiresAt,
  });
}

export async function createWorkspaceDoc(data: WorkspaceDoc) {
  const id = generateId(WORKSPACES_COLLECTION);
  await setDocument(WORKSPACES_COLLECTION, id, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (data.inviteCode && data.inviteCodeExpiresAt) {
    await writeInviteBridge(id, data.inviteCode, data.inviteCodeExpiresAt);
  }
  return id;
}

export async function getWorkspaceById(workspaceId: string) {
  return getDocument(WORKSPACES_COLLECTION, workspaceId) as Promise<(WorkspaceDoc & { id: string }) | null>;
}

// Guru baru (belum tergabung workspace mana pun) tidak boleh query
// collection workspaces langsung — itu akar masalah audit T2. Alih-alih,
// tempuh jembatan workspace_invites (get by ID, bukan query), lalu ambil
// dokumen workspace-nya (diizinkan lewat allow get bersyarat di
// firestore.rules). Kode yang sudah diganti (regenerateInviteCode) tetap
// ditolak lewat pengecekan `workspace.inviteCode !== inviteCode` — bekas
// jembatan lama boleh tetap ada, tapi tidak lagi cocok dengan kode aktif
// workspace-nya.
export async function findWorkspaceByInviteCode(inviteCode: string) {
  const bridge = (await getDocument(WORKSPACE_INVITES_COLLECTION, inviteCode)) as
    | { workspaceId?: string }
    | null;
  if (!bridge?.workspaceId) return null;

  const workspace = await getWorkspaceById(bridge.workspaceId);
  if (!workspace || workspace.inviteCode !== inviteCode) return null;
  return workspace;
}

export async function updateWorkspaceInviteCode(
  workspaceId: string,
  inviteCode: string,
  inviteCodeExpiresAt: number
) {
  await updateDocument(WORKSPACES_COLLECTION, workspaceId, {
    inviteCode,
    inviteCodeExpiresAt,
    updatedAt: serverTimestamp(),
  });
  await writeInviteBridge(workspaceId, inviteCode, inviteCodeExpiresAt);
}
