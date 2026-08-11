import {
  createIndividualWorkspace,
  createSchoolWorkspace,
  regenerateInviteCode,
  loadWorkspace,
  isClassLimitReached,
  assertClassLimitNotReached,
  isSeatLimitReached,
  assertSeatLimitNotReached,
  PLAN_CLASS_LIMITS,
  PLAN_PRICES,
} from '../services/workspaceService';
import { loadTeacherProfile } from '../services/teacherProfileService';

export async function submitCreateIndividualWorkspace(
  uid: string,
  plan: 'individual_lifetime' | 'individual_monthly',
  workspaceName: string
) {
  return createIndividualWorkspace(uid, plan, workspaceName);
}

export async function submitCreateSchoolWorkspace(uid: string, schoolName: string) {
  return createSchoolWorkspace(uid, schoolName);
}

// Lewat app/api/workspace/join (Admin SDK di server), bukan Firestore
// client SDK langsung — lihat komentar di lib/server/workspaceAdminService.ts
// untuk alasannya (seat-limit check butuh count query yang tidak bisa
// dibuat aman lewat firestore.rules untuk guru yang belum jadi anggota
// workspace tujuan). idToken didapat presentation layer dari
// auth.currentUser.getIdToken() setelah createUserWithEmailAndPassword —
// server memverifikasi ulang, uid tidak pernah dipercaya dari client.
export async function submitJoinWorkspaceByCode(idToken: string, inviteCode: string) {
  const res = await fetch('/api/workspace/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ inviteCode }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Gagal bergabung ke workspace.');
  }
  return data.workspace;
}

export async function submitRegenerateInviteCode(workspaceId: string) {
  return regenerateInviteCode(workspaceId);
}

export async function fetchWorkspace(workspaceId: string) {
  return loadWorkspace(workspaceId);
}

export async function fetchTeacherProfileForSession(uid: string) {
  return loadTeacherProfile(uid);
}

export {
  isClassLimitReached,
  assertClassLimitNotReached,
  isSeatLimitReached,
  assertSeatLimitNotReached,
  PLAN_CLASS_LIMITS,
  PLAN_PRICES,
};
