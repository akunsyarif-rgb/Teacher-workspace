import { SUBMISSION_STATUS, SCHOOL_DAYS_6 } from '../config/constants';

/**
 * Perhitungan murni untuk Student Companion: data masuk, ringkasan keluar,
 * tanpa menyentuh Firestore sama sekali.
 *
 * Dipisah dari studentPortalService supaya bisa diuji apa adanya. Ini
 * kategori kode yang paling mudah salah diam-diam — bug rata-rata nilai
 * (Number(null) bernilai 0, sehingga komponen yang belum dinilai menyeret
 * rata-rata siswa turun) hidup persis di sini dan lolos karena tidak ada
 * yang menjaganya.
 */

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function groupScheduleByDay(schedules: any[]) {
  return SCHOOL_DAYS_6.map((day) => ({
    day,
    items: schedules
      .filter((s: any) => s.day === day)
      .sort((a: any, b: any) => (a.timeSlot || '').localeCompare(b.timeSlot || '')),
  }));
}

export function mergeAssignmentsWithSubmissions(assignments: any[], submissions: any[]) {
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

export function buildPortfolio(assignmentsWithStatus: any[], gradeDocs: any[]) {
  const scoreByColumnId: Record<string, string> = {};
  gradeDocs.forEach((grade: any) => {
    scoreByColumnId[grade.columnId] = grade.score;
  });

  return assignmentsWithStatus
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

export function summarizeGrades(columns: any[], gradeDocs: any[]) {
  const byColumnId: Record<string, string> = {};
  gradeDocs.forEach((grade: any) => {
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

// Persentase kehadiran per bulan, urut lama -> baru, supaya siswa melihat
// arah perkembangannya (bukan cuma satu angka rata-rata sepanjang masa).
export function buildMonthlyRates(history: any[]) {
  const buckets: Record<string, { hadir: number; total: number }> = {};
  history.forEach((record) => {
    const month = (record.date || '').slice(0, 7); // YYYY-MM
    // Dicek dengan pola, bukan panjang: "bukan-tanggal" juga berpanjang 7
    // setelah dipotong, lolos pengecekan panjang, lalu muncul sebagai
    // batang bertuliskan sampah di grafik siswa.
    if (!/^\d{4}-\d{2}$/.test(month)) return;
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

// Satu dokumen presensi = satu sesi mengajar berisi status seluruh kelas;
// di sini disaring jadi baris milik satu siswa saja.
export function summarizeAttendance(records: any[], studentId: string) {
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
