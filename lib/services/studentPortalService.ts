import * as scheduleRepository from '../repositories/scheduleRepository';
import * as assignmentRepository from '../repositories/assignmentRepository';
import * as submissionRepository from '../repositories/submissionRepository';
import * as gradeRepository from '../repositories/gradeRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';
import * as attendanceRepository from '../repositories/attendanceRepository';
import * as announcementService from './announcementService';
import * as achievementService from './achievementService';
import {
  groupScheduleByDay,
  mergeAssignmentsWithSubmissions,
  buildPortfolio,
  summarizeGrades,
  summarizeAttendance,
} from '../utils/studentStats';

// Perhitungannya ada di lib/utils/studentStats.ts — murni, tanpa Firestore,
// supaya bisa diuji apa adanya (lihat tests/student-stats.test.ts). Berkas
// ini hanya mengurus pengambilan data.

export type StudentScope = {
  workspaceId: string;
  className: string;
  studentId: string;
};

// Pakai service guru apa adanya: aturan urut & bentuk datanya sama persis,
// dan pembatasan siapa boleh baca apa sudah dijaga firestore.rules.
export async function getAnnouncements({ workspaceId, className }: StudentScope) {
  return announcementService.listAnnouncements(workspaceId, className);
}

export async function getSchedule({ workspaceId, className }: StudentScope) {
  const schedules = await scheduleRepository.getSchedulesByClass(workspaceId, className);
  return groupScheduleByDay(schedules);
}

// Daftar tugas kelas digabung dengan submission milik siswa ini saja.
// Tugas tanpa dokumen submission = belum dikumpulkan (lihat submissionService).
export async function getAssignments({ workspaceId, className, studentId }: StudentScope) {
  const [assignments, submissions] = await Promise.all([
    assignmentRepository.getAssignmentsByClass(workspaceId, className),
    submissionRepository.getSubmissionsByStudent(workspaceId, studentId),
  ]);
  return mergeAssignmentsWithSubmissions(assignments, submissions);
}

// Hanya prestasi milik siswa ini — bukan sekelas. Dibatasi juga oleh
// rules, jadi filter di sini bukan satu-satunya penjaga.
export async function getAchievements({ workspaceId, studentId }: StudentScope) {
  return achievementService.listAchievementsForStudent(workspaceId, studentId);
}

// Portofolio = tugas yang sudah dinilai guru, lengkap dengan skor dan
// lampirannya. Skornya diambil dari collection grades lewat gradeColumnId
// milik tugas itu — bukan disalin ke dokumen submission — supaya angkanya
// selalu sama dengan yang ada di gradebook.
export async function getPortfolio(scope: StudentScope) {
  const [assignments, grades] = await Promise.all([
    getAssignments(scope),
    gradeRepository.getGradesByStudent(scope.workspaceId, scope.studentId),
  ]);
  return buildPortfolio(assignments, grades);
}

// Nilai siswa ini dipasangkan dengan judul kolomnya. Kolom yang belum
// dinilai tetap ditampilkan (score null) supaya siswa tahu komponen apa
// saja yang ada dan mana yang masih kosong.
export async function getGrades({ workspaceId, className, studentId }: StudentScope) {
  const [columns, grades] = await Promise.all([
    gradeColumnRepository.getColumnsByClass(workspaceId, className),
    gradeRepository.getGradesByStudent(workspaceId, studentId),
  ]);
  return summarizeGrades(columns, grades);
}

export async function getAttendance({ workspaceId, className, studentId }: StudentScope) {
  const records = await attendanceRepository.getAttendanceByClass(workspaceId, className);
  return summarizeAttendance(records, studentId);
}
