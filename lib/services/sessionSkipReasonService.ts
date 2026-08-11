import * as sessionSkipReasonRepository from '../repositories/sessionSkipReasonRepository';
import { SESSION_SKIP_REASONS } from '../config/constants';

const VALID_REASONS = Object.values(SESSION_SKIP_REASONS) as string[];

function todayDateString() {
  return new Date().toISOString().split('T')[0];
}

export async function listTodaySkipReasons(workspaceId: string) {
  if (!workspaceId) return [];
  return sessionSkipReasonRepository.getByDate(workspaceId, todayDateString());
}

// Guru mencatat/mengganti alasan sesi "Perlu Konfirmasi" — TIDAK mengubah
// hasAttendance/hasJournal, jadi sesi tetap tercatat belum lengkap. Ini
// murni lapisan konfirmasi/konteks, bukan pengganti presensi/jurnal (lihat
// "Prinsip utama" di spec: data presensi/jurnal = penentu penyelesaian).
export async function saveSkipReason(
  workspaceId: string,
  scheduleId: string,
  className: string,
  reason: string,
  note: string
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  if (!scheduleId) throw new Error('Sesi jadwal tidak valid.');
  if (!VALID_REASONS.includes(reason)) throw new Error('Alasan tidak valid.');
  if (reason === SESSION_SKIP_REASONS.LAINNYA && !note.trim()) {
    throw new Error('Keterangan wajib diisi untuk alasan "Lainnya".');
  }

  const date = todayDateString();
  const payload = {
    workspaceId,
    scheduleId,
    className,
    date,
    reason,
    note: note.trim(),
  };

  const existing = await sessionSkipReasonRepository.findByScheduleAndDate(workspaceId, scheduleId, date);
  if (existing) {
    await sessionSkipReasonRepository.updateSkipReason(existing.id, payload);
    return { id: existing.id, ...payload };
  }
  return sessionSkipReasonRepository.createSkipReason(payload);
}
