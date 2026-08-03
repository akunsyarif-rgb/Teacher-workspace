import { getAllSchedules, createSchedule, deleteSchedule } from '../repositories/scheduleRepository';

export type ScheduleInput = {
  day: string;
  timeSlot: string;
  className: string;
  subject: string;
};

export async function loadSchedules(workspaceId: string) {
  if (!workspaceId) return [];
  return getAllSchedules(workspaceId);
}

export async function addSchedule(workspaceId: string, input: ScheduleInput) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const className = input.className.trim();
  const timeSlot = input.timeSlot.trim();
  const subject = input.subject.trim();

  if (!className) throw new Error('Mohon isi nama kelas.');
  if (!timeSlot) throw new Error('Mohon isi jam pelajaran / waktu.');
  if (!subject) throw new Error('Mohon isi mata pelajaran.');

  return createSchedule(workspaceId, {
    day: input.day,
    timeSlot,
    className: className.toUpperCase(),
    subject,
  });
}

export async function removeSchedule(id: string) {
  return deleteSchedule(id);
}
