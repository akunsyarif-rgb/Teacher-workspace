import {
  createIndividualWorkspace,
  createSchoolWorkspace,
  joinWorkspaceByCode,
  regenerateInviteCode,
  loadWorkspace,
  isClassLimitReached,
  assertClassLimitNotReached,
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

export async function submitJoinWorkspaceByCode(uid: string, inviteCode: string) {
  return joinWorkspaceByCode(uid, inviteCode);
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

export { isClassLimitReached, assertClassLimitNotReached };
