import * as studentPortalService from '../services/studentPortalService';
import type { StudentScope } from '../services/studentPortalService';
import { withCache } from '../utils/sessionCache';

export async function fetchAnnouncements(scope: StudentScope) {
  if (!scope.workspaceId || !scope.className) return [];
  return withCache(`studentAnnouncements:${scope.workspaceId}:${scope.className}`, () =>
    studentPortalService.getAnnouncements(scope)
  );
}

export async function fetchSchedule(scope: StudentScope) {
  if (!scope.workspaceId || !scope.className) return [];
  return withCache(`studentSchedule:${scope.workspaceId}:${scope.className}`, () =>
    studentPortalService.getSchedule(scope)
  );
}

export async function fetchAssignments(scope: StudentScope) {
  if (!scope.workspaceId || !scope.className || !scope.studentId) return [];
  return withCache(`studentAssignments:${scope.workspaceId}:${scope.studentId}`, () =>
    studentPortalService.getAssignments(scope)
  );
}

export async function fetchGrades(scope: StudentScope) {
  if (!scope.workspaceId || !scope.className || !scope.studentId) {
    return { items: [], average: null };
  }
  return withCache(`studentGrades:${scope.workspaceId}:${scope.studentId}`, () =>
    studentPortalService.getGrades(scope)
  );
}

export async function fetchAttendance(scope: StudentScope) {
  if (!scope.workspaceId || !scope.className || !scope.studentId) {
    return { history: [], summary: {}, lateCount: 0, total: 0, attendanceRate: null };
  }
  return withCache(`studentAttendance:${scope.workspaceId}:${scope.studentId}`, () =>
    studentPortalService.getAttendance(scope)
  );
}
