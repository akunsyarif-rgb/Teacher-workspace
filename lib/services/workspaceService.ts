import {
  createWorkspaceDoc,
  getWorkspaceById,
  findWorkspaceByInviteCode,
  updateWorkspaceInviteCode,
  WorkspaceDoc,
} from '../repositories/workspaceRepository';
import { assignTeacherToWorkspace, loadTeacherProfile, countWorkspaceMembers } from './teacherProfileService';
import { FREE_CLASS_LIMIT, FREE_SEAT_LIMIT, PLAN_CLASS_LIMITS, PLAN_PRICES, PLAN_DURATION_MS } from '../config/plans';

// Re-export supaya kode lain (controller/UI) yang sudah mengimpor
// konstanta ini dari workspaceService tidak perlu berubah — sumber
// aslinya sekarang lib/config/plans.ts (tanpa dependensi Firestore),
// supaya bisa dipakai juga oleh lib/server/paymentService.ts (server-only).
export { FREE_CLASS_LIMIT, FREE_SEAT_LIMIT, PLAN_CLASS_LIMITS, PLAN_PRICES, PLAN_DURATION_MS };

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

  // Workspace sekolah dibuat dulu dengan batas GRATIS (sama seperti
  // individual) — classLimit & seatLimit baru terbuka penuh setelah
  // owner benar-benar membeli kursi guru lewat halaman upgrade. Tanpa
  // ini, sekolah baru langsung dapat kelas & kursi guru tak terbatas
  // gratis sejak mendaftar, dan paket berbayar jadi tidak berarti.
  const workspaceId = await createWorkspaceDoc({
    name: schoolName,
    plan: 'school_annual',
    ownerUid: uid,
    classLimit: FREE_CLASS_LIMIT,
    seatLimit: FREE_SEAT_LIMIT,
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

  const memberCount = await countWorkspaceMembers(workspace.id);
  assertSeatLimitNotReached(workspace, memberCount);

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

// Versi yang langsung menolak (throw) — dipanggil dari studentService
// saat guru mencoba menambah siswa ke kelas BARU.
export function assertClassLimitNotReached(workspace: WorkspaceDoc, currentClassCount: number) {
  if (isClassLimitReached(workspace, currentClassCount)) {
    throw new Error(
      `Paket Anda dibatasi maksimal ${workspace.classLimit} kelas. Hubungi admin untuk upgrade paket.`
    );
  }
}

// Sama seperti isClassLimitReached/assertClassLimitNotReached, tapi untuk
// kuota kursi guru (khusus school_annual) — dicek saat guru baru mau
// gabung lewat kode undangan.
export function isSeatLimitReached(workspace: WorkspaceDoc, currentMemberCount: number) {
  if (workspace.seatLimit === null || workspace.seatLimit === undefined) return false;
  return currentMemberCount >= workspace.seatLimit;
}

export function assertSeatLimitNotReached(workspace: WorkspaceDoc, currentMemberCount: number) {
  if (isSeatLimitReached(workspace, currentMemberCount)) {
    throw new Error(
      `Kuota guru workspace ini sudah penuh (maks ${workspace.seatLimit} guru). Admin sekolah perlu membeli kursi tambahan lewat halaman upgrade.`
    );
  }
}
