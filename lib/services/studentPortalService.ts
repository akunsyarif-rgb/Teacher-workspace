import * as scheduleRepository from '../repositories/scheduleRepository';
import * as assignmentRepository from '../repositories/assignmentRepository';
import * as submissionRepository from '../repositories/submissionRepository';
import * as gradeRepository from '../repositories/gradeRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';
import * as attendanceRepository from '../repositories/attendanceRepository';
import * as announcementService from './announcementService';
import * as achievementService from './achievementService';
import { SUBMISSION_STATUS, SCHOOL_DAYS_6 } from '../config/constants';

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
  const byDay = SCHOOL_DAYS_6.map((day) => ({
    day,
    items: schedules
      .filter((s: any) => s.day === day)
      .sort((a: any, b: any) => (a.timeSlot || '').localeCompare(b.timeSlot || '')),
  }));
  return byDay;
}

// Daftar tugas kelas digabung dengan submission milik siswa ini saja.
// Tugas tanpa dokumen submission = belum dikumpulkan (lihat submissionService).
export async function getAssignments({ workspaceId, className, studentId }: StudentScope) {
  const [assignments, submissions] = await Promise.all([
    assignmentRepository.getAssignmentsByClass(workspaceId, className),
    submissionRepository.getSubmissionsByStudent(workspaceId, studentId),
  ]);
  const byAssignmentId: Record<string, any> = {};
  submissions.forEach((sub: any) => {
    byAssignmentId[sub.assignmentId] = sub;
  });
  return assignments
    .map((assignment: any) => {
      const submission = byAssignmentId[assignment.id];
      return {
        ...assignment,
        status: submission?.status || SUBMISSION_STATUS.BELUM_MENGUMPULKAN,
        textAnswer: submission?.textAnswer || '',
        fileUrl: submission?.fileUrl || null,
        fileName: submission?.fileName || null,
        feedback: submission?.feedback || '',
        submittedAt: submission?.submittedAt || null,
      };
    })
    .sort((a: any, b: any) => (a.dueDate || '').localeCompare(b.dueDate || ''));
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

  const scoreByColumnId: Record<string, string> = {};
  grades.forEach((grade: any) => {
    scoreByColumnId[grade.columnId] = grade.score;
  });

  return assignments
    .filter((assignment: any) => assignment.status === SUBMISSION_STATUS.DINILAI)
    .map((assignment: any) => ({
      id: assignment.id,
      title: assignment.title,
      dueDate: assignment.dueDate,
      score: scoreByColumnId[assignment.gradeColumnId] ?? null,
      feedback: assignment.feedback,
      fileUrl: assignment.fileUrl,
      fileName: assignment.fileName,
      submittedAt: assignment.submittedAt,
    }))
    .sort((a: any, b: any) => (b.dueDate || '').localeCompare(a.dueDate || ''));
}

// Nilai siswa ini dipasangkan dengan judul kolomnya. Kolom yang belum
// dinilai tetap ditampilkan (score null) supaya siswa tahu komponen apa
// saja yang ada dan mana yang masih kosong.
export async function getGrades({ workspaceId, className, studentId }: StudentScope) {
  const [columns, grades] = await Promise.all([
    gradeColumnRepository.getColumnsByClass(workspaceId, className),
    gradeRepository.getGradesByStudent(workspaceId, studentId),
  ]);
  const byColumnId: Record<string, string> = {};
  grades.forEach((grade: any) => {
    byColumnId[grade.columnId] = grade.score;
  });

  const items = columns.map((column: any) => ({
    id: column.id,
    title: column.title,
    type: column.type,
    score: byColumnId[column.id] ?? null,
  }));

  // Kolom yang belum dinilai (score null / string kosong) tidak boleh ikut
  // dirata-rata — Number(null) itu 0, dan kalau lolos ke sini rata-rata
  // siswa akan tampak jatuh hanya karena gurunya belum sempat menilai.
  const numericScores = items
    .filter((item) => item.score !== null && String(item.score).trim() !== '')
    .map((item) => Number(item.score))
    .filter((score) => Number.isFinite(score));
  const average =
    numericScores.length > 0
      ? numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length
      : null;

  return { items, average };
}

// Satu dokumen presensi = satu sesi mengajar berisi status seluruh kelas;
// di sini disaring jadi baris milik siswa ini saja.
export async function getAttendance({ workspaceId, className, studentId }: StudentScope) {
  const records = await attendanceRepository.getAttendanceByClass(workspaceId, className);
  const summary: Record<string, number> = { Hadir: 0, Sakit: 0, Izin: 0, Dispensasi: 0, Alpa: 0 };
  let lateCount = 0;

  const history = records
    .map((record: any) => {
      const mine = (record.details || []).find((detail: any) => detail.studentId === studentId);
      if (!mine) return null;
      if (summary[mine.status] !== undefined) summary[mine.status] += 1;
      if (mine.late) lateCount += 1;
      return {
        id: record.id,
        date: record.date,
        subject: record.subject,
        status: mine.status,
        late: !!mine.late,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));

  const total = history.length;
  const attendanceRate = total > 0 ? Math.round((summary.Hadir / total) * 100) : null;

  return { history, summary, lateCount, total, attendanceRate, monthly: buildMonthlyRates(history) };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Persentase kehadiran per bulan, urut lama -> baru, supaya siswa melihat
// arah perkembangannya (bukan cuma satu angka rata-rata sepanjang masa).
function buildMonthlyRates(history: any[]) {
  const buckets: Record<string, { hadir: number; total: number }> = {};
  history.forEach((record) => {
    const month = (record.date || '').slice(0, 7); // YYYY-MM
    if (month.length !== 7) return;
    if (!buckets[month]) buckets[month] = { hadir: 0, total: 0 };
    buckets[month].total += 1;
    if (record.status === 'Hadir') buckets[month].hadir += 1;
  });

  return Object.keys(buckets)
    .sort()
    .map((month) => {
      const [year, monthNumber] = month.split('-');
      return {
        month,
        label: `${MONTH_LABELS[Number(monthNumber) - 1] || monthNumber} ${year.slice(2)}`,
        rate: Math.round((buckets[month].hadir / buckets[month].total) * 100),
        total: buckets[month].total,
      };
    });
}
