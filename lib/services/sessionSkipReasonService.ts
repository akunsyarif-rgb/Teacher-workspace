import * as sessionSkipReasonRepository from '../repositories/sessionSkipReasonRepository';
import { SESSION_SKIP_REASONS } from '../config/constants';
import { getWitaDateString } from '../utils/witaDate';

const VALID_REASONS = Object.values(SESSION_SKIP_REASONS) as string[];

function todayDateString() {
  return getWitaDateString();
}

export async function listTodaySkipReasons(workspaceId: string) {
  if (!workspaceId) return [];
  return sessionSkipReasonRepository.getByDate(workspaceId, todayDateString());
}

// Guru mencatat/mengganti alasan sesi "Perlu Konfirmasi". TIDAK mengubah
// hasAttendance/hasJournal itu sendiri (bukan pengganti presensi/jurnal),
// TAPI begitu tersimpan, dashboardService menandai sesi ini isSkipped=true
// ("Tidak Mengajar") — dikeluarkan dari daftar pekerjaan belum selesai,
// bukan lagi sekadar konteks tambahan seperti sebelumnya. Untuk versi ini
// hanya bisa diisi SETELAH sesi terlewat (dipicu dari daftar "Perlu
// Konfirmasi" di Beranda) — bukan proaktif sebelum jam mengajar. Signature
// di sini sengaja sudah generik (scheduleId+date, bukan terikat ke waktu
// sesi lewat), supaya nanti pengisian proaktif tinggal ditambah pemanggil
// baru tanpa mengubah service/repository ini.
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
