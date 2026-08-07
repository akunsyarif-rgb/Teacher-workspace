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
  return new Date().toISOString().split('T')[0];
}

/**
 * Bagian murni: menerima data mentah, mengembalikan temuan. Dipisah dari
 * pengambilan data supaya logikanya bisa diuji tanpa Firestore sama
 * sekali (lihat tests/analytics.test.ts).
 */
export function buildInsights(input: {
  students: any[];
  attendances: any[];
  journals: any[];
  assignments: any[];
  submissions: any[];
  today?: string;
}): Insight[] {
  const { students, attendances, journals, assignments, submissions } = input;
  const today = input.today || todayISO();
  const insights: Insight[] = [];

  // ===== 1. Siswa yang perlu perhatian (kehadiran) =====
  // Satu dokumen presensi memuat seluruh kelas, jadi rekap per siswa
  // dihitung dengan membongkar details[] tiap pertemuan.
  const perStudent: Record<string, { name: string; className: string; hadir: number; alpa: number; total: number }> = {};

  attendances.forEach((record: any) => {
    (record.details || []).forEach((detail: any) => {
      if (!detail?.studentId) return;
      if (!perStudent[detail.studentId]) {
        perStudent[detail.studentId] = {
          name: detail.name || 'Siswa',
          className: record.className || '-',
          hadir: 0,
          alpa: 0,
          total: 0,
        };
      }
      const entry = perStudent[detail.studentId];
      entry.total += 1;
      if (detail.status === 'Hadir') entry.hadir += 1;
      if (detail.status === 'Alpa') entry.alpa += 1;
    });
  });

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
      href: s.alpa >= THRESHOLDS.ALPA_COUNT ? '/komunikasi-ortu' : '/konseling',
    });
  });

  // ===== 2. Tugas lewat tenggat dengan pengumpulan rendah =====
  const studentsPerClass: Record<string, number> = {};
  students.forEach((student: any) => {
    const cls = student.className?.trim();
    if (!cls) return;
    studentsPerClass[cls] = (studentsPerClass[cls] || 0) + 1;
  });

  const submissionCount: Record<string, number> = {};
  submissions.forEach((sub: any) => {
    if (!sub?.assignmentId) return;
    submissionCount[sub.assignmentId] = (submissionCount[sub.assignmentId] || 0) + 1;
  });

  assignments.forEach((assignment: any) => {
    if (!assignment.dueDate || assignment.dueDate >= today) return; // belum lewat tenggat
    const classSize = studentsPerClass[assignment.className?.trim()] || 0;
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
      href: `/attendance?class=${encodeURIComponent(assignment.className)}&tab=pengumuman`,
    });
  });

  // ===== 3. Presensi sudah diisi tapi jurnalnya belum =====
  // Dipasangkan per (kelas, tanggal): kalau presensi ada tapi jurnal
  // tidak, berarti pertemuannya terjadi tapi administrasinya tertinggal.
  const journalKeys = new Set(
    journals.map((j: any) => `${j.className?.trim()}__${j.date}`)
  );

  attendances.forEach((record: any) => {
    const key = `${record.className?.trim()}__${record.date}`;
    if (journalKeys.has(key)) return;
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
