import { getWitaDateString } from './witaDate';
/**
 * Analitik di sini sengaja BUKAN sekadar angka: tiap temuan wajib punya
 * rekomendasi tindakan dan tautan langsung ke tempat mengerjakannya.
 * Grafik yang cuma menampilkan tren memaksa guru menyimpulkan sendiri —
 * dan itu justru pekerjaan tambahan, bukan pengurangan.
 */

// Jendela analisis. Dibatasi (bukan sepanjang masa) karena mengunduh
// seluruh riwayat membuat halaman makin lambat tiap hari — masalah yang
// sudah pernah terjadi di ringkasan dashboard.
export const ANALYSIS_WINDOW_DAYS = 30;

// Ambang batas dikumpulkan di sini supaya bisa ditinjau sekaligus, dan
// tiap angka punya alasan — bukan tebakan yang tersebar di dalam kode.
export const THRESHOLDS = {
  // Di bawah 80% kehadiran umumnya sudah jadi perhatian wali kelas.
  LOW_ATTENDANCE_RATE: 80,
  // Butuh cukup pertemuan sebelum sebuah persentase berarti apa-apa:
  // 1 dari 2 pertemuan = 50%, tapi itu belum menunjukkan pola.
  MIN_SESSIONS_FOR_RATE: 4,
  // Tiga kali alpa dalam sebulan layak ditindaklanjuti walau
  // persentasenya masih terlihat aman.
  ALPA_COUNT: 3,
  // Tugas yang sudah lewat tenggat tapi separuh kelas belum mengumpulkan
  // biasanya menandakan soal instruksi/tenggat, bukan kemalasan.
  LOW_SUBMISSION_RATE: 50,
};

export type Insight = {
  id: string;
  severity: 'tinggi' | 'sedang';
  category: 'kehadiran' | 'tugas' | 'administrasi';
  title: string;
  detail: string;
  recommendation: string;
  href: string;
};

function todayISO() {
  return getWitaDateString();
}

/**
 * Bagian murni: menerima data mentah, mengembalikan temuan. Dipisah dari
 * pengambilan data supaya logikanya bisa diuji tanpa Firestore sama
 * sekali (lihat tests/analytics.test.ts).
 */
export type AttendanceLike = {
  id?: string; date?: string; className?: string;
  details?: { studentId?: string; name?: string; status?: string }[];
};
export type JournalLike = { className?: string; date?: string; [k: string]: unknown };
export type StudentLike = { className?: string };
export type AssignmentLike = { id: string; className?: string; title?: string; dueDate?: string };
export type SubmissionLike = { assignmentId?: string; [k: string]: unknown };
export type StudentAgg = { name: string; className: string; hadir: number; alpa: number; total: number };
export type MissingJournal = { id: string; className: string; date: string };

/** Rekap per siswa dari dokumen presensi mentah (urutan kemunculan pertama dipertahankan). */
export function aggregateAttendance(attendances: AttendanceLike[]): Record<string, StudentAgg> {
  const perStudent: Record<string, StudentAgg> = {};
  attendances.forEach((record) => {
    (record.details || []).forEach((detail) => {
      if (!detail?.studentId) return;
      if (!perStudent[detail.studentId]) {
        perStudent[detail.studentId] = { name: detail.name || 'Siswa', className: record.className || '-', hadir: 0, alpa: 0, total: 0 };
      }
      const entry = perStudent[detail.studentId];
      entry.total += 1;
      if (detail.status === 'Hadir') entry.hadir += 1;
      if (detail.status === 'Alpa') entry.alpa += 1;
    });
  });
  return perStudent;
}

/** Sesi presensi yang jurnalnya (kelas+tanggal sama) belum ada. */
export function findMissingJournals(attendances: AttendanceLike[], journals: JournalLike[]): MissingJournal[] {
  const journalKeys = new Set(journals.map((j) => `${j.className?.trim()}__${j.date}`));
  const out: MissingJournal[] = [];
  attendances.forEach((record) => {
    if (journalKeys.has(`${record.className?.trim()}__${record.date}`)) return;
    out.push({ id: record.id as string, className: record.className as string, date: record.date as string });
  });
  return out;
}

export function countStudentsPerClass(students: StudentLike[]): Record<string, number> {
  const studentsPerClass: Record<string, number> = {};
  students.forEach((student) => {
    const cls = student.className?.trim();
    if (!cls) return;
    studentsPerClass[cls] = (studentsPerClass[cls] || 0) + 1;
  });
  return studentsPerClass;
}

export function countSubmissionsPerAssignment(submissions: SubmissionLike[]): Record<string, number> {
  const submissionCount: Record<string, number> = {};
  submissions.forEach((sub) => {
    if (!sub?.assignmentId) return;
    submissionCount[sub.assignmentId] = (submissionCount[sub.assignmentId] || 0) + 1;
  });
  return submissionCount;
}

/** Versi dari data mentah (dipakai tes & jalur lama); mengagregasi lalu memanggil buildInsightsFromAggregates. */
export function buildInsights(input: {
  students: StudentLike[];
  attendances: AttendanceLike[];
  journals: JournalLike[];
  assignments: AssignmentLike[];
  submissions: SubmissionLike[];
  today?: string;
}): Insight[] {
  return buildInsightsFromAggregates({
    perStudent: aggregateAttendance(input.attendances),
    missingJournals: findMissingJournals(input.attendances, input.journals),
    studentsPerClass: countStudentsPerClass(input.students),
    submissionCount: countSubmissionsPerAssignment(input.submissions),
    assignments: input.assignments,
    today: input.today,
  });
}

export function buildInsightsFromAggregates(input: {
  perStudent: Record<string, StudentAgg>;
  missingJournals: MissingJournal[];
  studentsPerClass: Record<string, number>;
  submissionCount: Record<string, number>;
  assignments: AssignmentLike[];
  today?: string;
}): Insight[] {
  const { perStudent, missingJournals, studentsPerClass, submissionCount, assignments } = input;
  const today = input.today || todayISO();
  const insights: Insight[] = [];

  // ===== 1. Siswa yang perlu perhatian (kehadiran) =====
  Object.keys(perStudent).forEach((studentId) => {
    const s = perStudent[studentId];
    const rate = s.total > 0 ? Math.round((s.hadir / s.total) * 100) : 100;
    const enoughData = s.total >= THRESHOLDS.MIN_SESSIONS_FOR_RATE;
    const lowRate = enoughData && rate < THRESHOLDS.LOW_ATTENDANCE_RATE;
    const manyAlpa = s.alpa >= THRESHOLDS.ALPA_COUNT;

    if (!lowRate && !manyAlpa) return;

    insights.push({
      id: `kehadiran-${studentId}`,
      severity: rate < 60 || s.alpa >= 5 ? 'tinggi' : 'sedang',
      category: 'kehadiran',
      title: `${s.name} (${s.className}) perlu perhatian`,
      detail: `Hadir ${s.hadir} dari ${s.total} pertemuan (${rate}%)${
        s.alpa > 0 ? `, alpa ${s.alpa} kali` : ''
      } dalam ${ANALYSIS_WINDOW_DAYS} hari terakhir.`,
      recommendation:
        s.alpa >= THRESHOLDS.ALPA_COUNT
          ? 'Hubungi orang tua dan catat hasilnya di Komunikasi Ortu.'
          : 'Tanyakan langsung penyebabnya, lalu catat di Konseling bila perlu.',
      href: s.alpa >= THRESHOLDS.ALPA_COUNT ? '/wali-kelas/komunikasi-ortu' : '/wali-kelas/konseling',
    });
  });

  // ===== 2. Tugas lewat tenggat dengan pengumpulan rendah =====
  assignments.forEach((assignment) => {
    if (!assignment.dueDate || assignment.dueDate >= today) return; // belum lewat tenggat
    const classSize = studentsPerClass[assignment.className?.trim() as string] || 0;
    if (classSize === 0) return;

    const submitted = submissionCount[assignment.id] || 0;
    const rate = Math.round((submitted / classSize) * 100);
    if (rate >= THRESHOLDS.LOW_SUBMISSION_RATE) return;

    insights.push({
      id: `tugas-${assignment.id}`,
      severity: rate < 25 ? 'tinggi' : 'sedang',
      category: 'tugas',
      title: `Tugas "${assignment.title}" sepi pengumpulan`,
      detail: `Baru ${submitted} dari ${classSize} siswa kelas ${assignment.className} mengumpulkan, padahal tenggatnya ${assignment.dueDate}.`,
      recommendation:
        'Periksa apakah instruksinya jelas, lalu ingatkan lewat Pengumuman ke kelas itu.',
      href: `/attendance?class=${encodeURIComponent(assignment.className as string)}&tab=pengumuman`,
    });
  });

  // ===== 3. Presensi sudah diisi tapi jurnalnya belum =====
  // Dipasangkan per (kelas, tanggal): kalau presensi ada tapi jurnal
  // tidak, berarti pertemuannya terjadi tapi administrasinya tertinggal.
  missingJournals.forEach((record) => {
    insights.push({
      id: `jurnal-${record.id}`,
      severity: 'sedang',
      category: 'administrasi',
      title: `Jurnal kelas ${record.className} tanggal ${record.date} belum diisi`,
      detail: 'Presensi pertemuan ini sudah tercatat, tapi jurnal mengajarnya belum ada.',
      recommendation: 'Isi jurnal selagi materinya masih diingat.',
      href: `/attendance?class=${encodeURIComponent(record.className)}&tab=jurnal`,
    });
  });

  // Yang paling mendesak di atas; selebihnya urut kategori supaya temuan
  // sejenis berkelompok dan enak dibaca.
  const severityRank = { tinggi: 0, sedang: 1 };
  return insights.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.category.localeCompare(b.category)
  );
}
