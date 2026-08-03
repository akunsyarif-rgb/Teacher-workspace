import { loadSchedules, addSchedule, removeSchedule, ScheduleInput } from '../services/scheduleService';

export async function fetchSchedules(workspaceId: string) {
  if (!workspaceId) return [];
  return loadSchedules(workspaceId);
}

export async function submitSchedule(workspaceId: string, input: ScheduleInput) {
  return addSchedule(workspaceId, input);
}

export async function deleteScheduleById(id: string) {
  return removeSchedule(id);
}
