import { loadSchedules, addSchedule, removeSchedule, ScheduleInput } from '../services/scheduleService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export async function fetchSchedules(workspaceId: string) {
  if (!workspaceId) return [];
  return withCache(`schedules:${workspaceId}`, () => loadSchedules(workspaceId));
}

export async function submitSchedule(workspaceId: string, input: ScheduleInput) {
  const result = await addSchedule(workspaceId, input);
  clearAllCached();
  return result;
}

export async function deleteScheduleById(id: string) {
  const result = await removeSchedule(id);
  clearAllCached();
  return result;
}
