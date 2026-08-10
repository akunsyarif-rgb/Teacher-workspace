import * as studentAuthService from '../services/studentAuthService';

export async function fetchCurrentStudentProfile(authUid: string) {
  if (!authUid) return null;
  return studentAuthService.getCurrentStudentProfile(authUid);
}

export async function claimAccessCode(accessCode: string, authUid: string) {
  return studentAuthService.claimAccessCode(accessCode, authUid);
}

export async function warmupConnection() {
  return studentAuthService.warmupConnection();
}
