import { adminCount, adminGetOne, adminSelect, adminUpdate, adminUpsert } from './supabaseAdmin';
import { isSeatLimitReached } from '../config/plans';

const WORKSPACES_COLLECTION = 'workspaces';
const WORKSPACE_INVITES_COLLECTION = 'workspace_invites';
const TEACHER_PROFILES_COLLECTION = 'teacher_profiles';

type WorkspaceRecord = {
  id: string;
  name: string;
  plan: string;
  ownerUid: string;
  classLimit: number | null;
  seatLimit?: number | null;
  inviteCode?: string;
  inviteCodeExpiresAt?: number;
  [key: string]: unknown;
};

export async function joinWorkspaceByCodeServer(uid: string, inviteCode: string): Promise<WorkspaceRecord> {
  const existingProfile = await adminGetOne<any>(TEACHER_PROFILES_COLLECTION, 'userId', uid);
  if (existingProfile?.workspaceId) {
    throw new Error('Akun ini sudah terhubung ke sebuah Workspace. Satu akun hanya boleh memiliki satu Workspace.');
  }

  const trimmedCode = inviteCode.trim().toUpperCase();
  if (!trimmedCode) throw new Error('Mohon masukkan kode undangan.');

  const bridges = await adminSelect<any>(WORKSPACE_INVITES_COLLECTION, [['code', '==', trimmedCode]]);
  const workspaceId = bridges[0]?.workspaceId;
  if (!workspaceId) throw new Error('Kode undangan tidak ditemukan.');

  const workspace = await adminGetOne<WorkspaceRecord>(WORKSPACES_COLLECTION, 'id', workspaceId);
  if (!workspace) throw new Error('Kode undangan tidak ditemukan.');
  if (workspace.inviteCode !== trimmedCode) throw new Error('Kode undangan tidak ditemukan.');
  if (workspace.inviteCodeExpiresAt && workspace.inviteCodeExpiresAt < Date.now()) {
    throw new Error('Kode undangan sudah kedaluwarsa. Minta admin sekolah membuat kode baru.');
  }

  const memberCount = await adminCount(TEACHER_PROFILES_COLLECTION, [['workspaceId', '==', workspaceId]]);
  if (isSeatLimitReached(workspace, memberCount)) {
    throw new Error(`Kuota guru workspace ini sudah penuh (maks ${workspace.seatLimit} guru). Admin sekolah perlu membeli kursi tambahan lewat halaman upgrade.`);
  }

  await adminUpsert(TEACHER_PROFILES_COLLECTION, {
    userId: uid,
    workspaceId,
    role: 'TEACHER',
    isActive: true,
  });

  return workspace;
}
