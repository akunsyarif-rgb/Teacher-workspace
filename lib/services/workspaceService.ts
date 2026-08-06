import {
  createWorkspaceDoc,
  getWorkspaceById,
  findWorkspaceByInviteCode,
  updateWorkspaceInviteCode,
  WorkspaceDoc,
  WorkspacePlan,
} from '../repositories/workspaceRepository';
import { assignTeacherToWorkspace, loadTeacherProfile } from './teacherProfileService';

const INVITE_CODE_VALID_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

// Penjaga aturan "satu akun = satu Workspace". Dipanggil di setiap jalur
// yang bisa membuat guru punya workspace (buat baru ATAU gabung pakai kode)
// supaya tidak ada yang diam-diam menimpa workspace lama guru.
async function assertNoExistingWorkspace(uid: string) {
  const profile = await loadTeacherProfile(uid);
  if (profile?.workspaceId) {
    throw new Error(
      'Akun ini sudah terhubung ke sebuah Workspace. Satu akun hanya boleh memiliki satu Workspace.'
    );
  }
}

// Batas kelas per paket. null = tak terbatas.
// Angka ini sengaja dipusatkan di satu tempat supaya gampang diubah nanti
// berdasarkan data pemakaian nyata, tanpa perlu cari-cari di banyak file.
// individual_lifetime = tier gratis: 3 kelas sengaja dibuat pas-pasan
// (bukan 10) supaya guru dengan beban mengajar normal tetap punya alasan
// upgrade ke paket berbayar, bukan malah cukup selamanya di tier gratis.
export const PLAN_CLASS_LIMITS: Record<WorkspacePlan, number | null> = {
  individual_lifetime: 3,
  individual_monthly: null,
  school_annual: null,
};

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I biar tidak salah baca
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function createIndividualWorkspace(
  uid: string,
  plan: 'individual_lifetime' | 'individual_monthly',
  workspaceName: string
) {
  await assertNoExistingWorkspace(uid);

  const workspaceId = await createWorkspaceDoc({
    name: workspaceName,
    plan,
    ownerUid: uid,
    classLimit: PLAN_CLASS_LIMITS[plan],
  });
  await assignTeacherToWorkspace(uid, workspaceId, 'OWNER');
  return getWorkspaceById(workspaceId);
}

export async function createSchoolWorkspace(uid: string, schoolName: string) {
  await assertNoExistingWorkspace(uid);

  const inviteCode = generateInviteCode();
  const inviteCodeExpiresAt = Date.now() + INVITE_CODE_VALID_MS;

  const workspaceId = await createWorkspaceDoc({
    name: schoolName,
    plan: 'school_annual',
    ownerUid: uid,
    classLimit: PLAN_CLASS_LIMITS.school_annual,
    inviteCode,
    inviteCodeExpiresAt,
  });
  await assignTeacherToWorkspace(uid, workspaceId, 'OWNER');
  return getWorkspaceById(workspaceId);
}

export async function joinWorkspaceByCode(uid: string, inviteCode: string) {
  await assertNoExistingWorkspace(uid);

  const trimmedCode = inviteCode.trim().toUpperCase();
  if (!trimmedCode) {
    throw new Error('Mohon masukkan kode undangan.');
  }

  const workspace = await findWorkspaceByInviteCode(trimmedCode);
  if (!workspace) {
    throw new Error('Kode undangan tidak ditemukan.');
  }
  if (workspace.inviteCodeExpiresAt && workspace.inviteCodeExpiresAt < Date.now()) {
    throw new Error('Kode undangan sudah kedaluwarsa. Minta admin sekolah membuat kode baru.');
  }

  await assignTeacherToWorkspace(uid, workspace.id, 'TEACHER');
  return workspace;
}

export async function regenerateInviteCode(workspaceId: string) {
  const inviteCode = generateInviteCode();
  const inviteCodeExpiresAt = Date.now() + INVITE_CODE_VALID_MS;
  await updateWorkspaceInviteCode(workspaceId, inviteCode, inviteCodeExpiresAt);
  return { inviteCode, inviteCodeExpiresAt };
}

export async function loadWorkspace(workspaceId: string) {
  return getWorkspaceById(workspaceId);
}

// Fungsi murni (tidak query apapun) — dipanggil dengan jumlah kelas yang
// sudah dihitung di tempat lain (mis. dari daftar kelas unik siswa).
export function isClassLimitReached(workspace: WorkspaceDoc, currentClassCount: number) {
  if (workspace.classLimit === null || workspace.classLimit === undefined) return false;
  return currentClassCount >= workspace.classLimit;
}

// Versi yang langsung menolak (throw) — ini yang sebenarnya dipanggil dari
// studentService saat guru mencoba menambah siswa ke kelas BARU. Belum
// terpasang di manapun sampai studentService ikut disesuaikan (menyusul,
// menunggu isi file repository lama Anda kirimkan).
export function assertClassLimitNotReached(workspace: WorkspaceDoc, currentClassCount: number) {
  if (isClassLimitReached(workspace, currentClassCount)) {
    throw new Error(
      `Paket Anda dibatasi maksimal ${workspace.classLimit} kelas. Hubungi admin untuk upgrade paket.`
    );
  }
}
