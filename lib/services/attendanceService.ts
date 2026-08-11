import * as attendanceRepository from '../repositories/attendanceRepository';
import { ATTENDANCE_STATUS_OPTIONS } from '../config/constants';
import { getWitaDateString } from '../utils/witaDate';

export async function listAttendanceHistory(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return attendanceRepository.getAttendanceByClass(workspaceId, className);
}

export type AttendanceEntry = { status: string; late?: boolean };

function todayDateString() {
  return getWitaDateString();
}

// "Terlambat" bukan status sendiri — cuma atribut tambahan di atas Hadir
// (late: true), supaya siswa terlambat tetap terhitung hadir di rekap,
// sambil tetap tercatat terpisah di summary.terlambat untuk visibilitas
// disiplin.
function buildAttendancePayload(
  workspaceId: string,
  className: string,
  subject: string,
  students: { id: string; name: string; nis?: string }[],
  statusMap: Record<string, AttendanceEntry>,
  scheduleId?: string | null
) {
  const summary: Record<string, number> = { hadir: 0, sakit: 0, izin: 0, dispensasi: 0, alpa: 0, terlambat: 0 };
  const details = students.map((student) => {
    const entry = statusMap[student.id];
    const status = (ATTENDANCE_STATUS_OPTIONS as readonly string[]).includes(entry?.status as any)
      ? entry.status
      : 'Hadir';
    const late = status === 'Hadir' && !!entry?.late;
    const key = status.toLowerCase();
    if (summary[key] !== undefined) summary[key] += 1;
    if (late) summary.terlambat += 1;
    return { studentId: student.id, name: student.name, nis: student.nis || '-', status, late };
  });
  return {
    workspaceId,
    className,
    subject: subject.trim(),
    date: todayDateString(),
    summary,
    details,
    scheduleId: scheduleId ?? null,
  };
}

// Dipanggil sekali saat tab Presensi dibuka — kalau sesi hari ini sudah
// pernah mulai disimpan (auto-save sebelumnya, atau guru sempat pindah
// tab/kelas lalu balik lagi), form harus terisi ulang dari data itu, bukan
// mulai dari nol lagi. Ini juga yang memungkinkan koreksi: status yang
// sudah tersimpan tetap terlihat & bisa diubah lagi.
export async function loadTodayAttendance(workspaceId: string, className: string, scheduleId?: string | null) {
  if (!workspaceId || !className) return null;
  return attendanceRepository.findTodayAttendance(workspaceId, className, scheduleId ?? null, todayDateString());
}

// Auto-save presensi (audit "Perencanaan Workflow Dalam Kelas"): sesi
// pertama kali disimpan lewat create, toggle-toggle berikutnya meng-UPDATE
// dokumen yang sama (upsert per sesi/hari), bukan bikin dokumen baru tiap
// kali guru mengoreksi satu siswa. existingId null di percobaan pertama.
export async function autoSaveAttendance(
  existingId: string | null,
  workspaceId: string,
  className: string,
  subject: string,
  students: { id: string; name: string; nis?: string }[],
  statusMap: Record<string, AttendanceEntry>,
  scheduleId?: string | null
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  if (!className) throw new Error('Kelas tidak valid.');
  const payload = buildAttendancePayload(workspaceId, className, subject, students, statusMap, scheduleId);
  if (existingId) {
    await attendanceRepository.updateAttendance(existingId, payload);
    return existingId;
  }
  const created = await attendanceRepository.createAttendance(payload);
  return created.id as string;
}

// Penanda "✓ Presensi selesai" — status eksplisit, bukan otomatis dari
// "semua siswa sudah ada statusnya" (semua siswa SELALU punya status sejak
// awal, default Hadir, jadi itu bukan sinyal yang berarti). Tetap boleh
// dikoreksi setelah ini (lihat komentar di AttendanceTab.tsx) — flag ini
// tidak mengunci apa pun, murni label progres, beda dari proteksi Nilai.
export async function markAttendanceCompleted(id: string) {
  return attendanceRepository.updateAttendance(id, { completed: true });
}

export async function removeAttendance(id: string) {
  return attendanceRepository.deleteAttendance(id);
}
