import { describe, expect, it } from 'vitest';
import {
  summarizeGrades,
  summarizeAttendance,
  buildMonthlyRates,
  mergeAssignmentsWithSubmissions,
  buildPortfolio,
  groupScheduleByDay,
} from '../lib/utils/studentStats';

// Perhitungan yang dilihat siswa tentang dirinya sendiri. Salah sedikit di
// sini tidak bikin aplikasi error — cuma menampilkan angka yang keliru,
// dan itu justru jenis kesalahan yang bisa bertahan lama tanpa ketahuan.

describe('summarizeGrades — rata-rata nilai', () => {
  const columns = [
    { id: 'c1', title: 'Tugas 1', type: 'Tugas' },
    { id: 'c2', title: 'UH', type: 'UH' },
    { id: 'c3', title: 'UAS', type: 'UAS' },
  ];

  it('menghitung rata-rata dari nilai yang ada', () => {
    const result = summarizeGrades(columns, [
      { columnId: 'c1', score: '80' },
      { columnId: 'c2', score: '90' },
      { columnId: 'c3', score: '70' },
    ]);
    expect(result.average).toBe(80);
    expect(result.items).toHaveLength(3);
  });

  it('TIDAK menghitung kolom yang belum dinilai sebagai nol', () => {
    // Ini bug yang pernah ada: Number(null) === 0, sehingga siswa dengan
    // satu nilai 90 dan dua kolom kosong tampak rata-rata 30.
    const result = summarizeGrades(columns, [{ columnId: 'c1', score: '90' }]);
    expect(result.average).toBe(90);
  });

  it('mengabaikan nilai berupa string kosong', () => {
    const result = summarizeGrades(columns, [
      { columnId: 'c1', score: '90' },
      { columnId: 'c2', score: '' },
      { columnId: 'c3', score: '   ' },
    ]);
    expect(result.average).toBe(90);
  });

  it('mengabaikan nilai yang bukan angka', () => {
    const result = summarizeGrades(columns, [
      { columnId: 'c1', score: '80' },
      { columnId: 'c2', score: 'belum' },
    ]);
    expect(result.average).toBe(80);
  });

  it('mengembalikan null (bukan 0) saat belum ada nilai sama sekali', () => {
    const result = summarizeGrades(columns, []);
    expect(result.average).toBeNull();
    expect(result.items.every((i) => i.score === null)).toBe(true);
  });

  it('tetap menampilkan semua kolom walau sebagian belum dinilai', () => {
    const result = summarizeGrades(columns, [{ columnId: 'c2', score: '75' }]);
    expect(result.items.map((i) => i.score)).toEqual([null, '75', null]);
  });
});

describe('summarizeAttendance — rekap kehadiran siswa', () => {
  function record(id: string, date: string, status: string, late = false, studentId = 's1') {
    return {
      id,
      date,
      subject: 'Matematika',
      details: [{ studentId, name: 'Budi', status, late }],
    };
  }

  it('hanya menghitung baris milik siswa yang diminta', () => {
    const records = [
      {
        id: 'a1',
        date: '2026-03-01',
        details: [
          { studentId: 's1', status: 'Hadir' },
          { studentId: 's2', status: 'Alpa' },
        ],
      },
    ];
    const result = summarizeAttendance(records, 's1');
    expect(result.total).toBe(1);
    expect(result.summary.Hadir).toBe(1);
    expect(result.summary.Alpa).toBe(0);
  });

  it('melewati pertemuan yang tidak memuat siswa itu sama sekali', () => {
    const records = [record('a1', '2026-03-01', 'Hadir'), { id: 'a2', date: '2026-03-02', details: [] }];
    const result = summarizeAttendance(records, 's1');
    expect(result.total).toBe(1);
  });

  it('menghitung persentase kehadiran dari total pertemuan', () => {
    const records = [
      record('a1', '2026-03-01', 'Hadir'),
      record('a2', '2026-03-02', 'Hadir'),
      record('a3', '2026-03-03', 'Sakit'),
      record('a4', '2026-03-04', 'Alpa'),
    ];
    const result = summarizeAttendance(records, 's1');
    expect(result.attendanceRate).toBe(50);
    expect(result.summary.Sakit).toBe(1);
    expect(result.summary.Alpa).toBe(1);
  });

  it('menghitung terlambat sebagai HADIR, bukan status terpisah', () => {
    // "Terlambat" memang atribut di atas Hadir (lihat constants.ts) supaya
    // siswa terlambat tidak ikut menurunkan angka kehadirannya.
    const records = [record('a1', '2026-03-01', 'Hadir', true), record('a2', '2026-03-02', 'Hadir')];
    const result = summarizeAttendance(records, 's1');
    expect(result.attendanceRate).toBe(100);
    expect(result.lateCount).toBe(1);
  });

  it('mengembalikan null (bukan 0%) saat belum ada pertemuan', () => {
    const result = summarizeAttendance([], 's1');
    expect(result.attendanceRate).toBeNull();
    expect(result.total).toBe(0);
  });

  it('mengurutkan riwayat dari yang terbaru', () => {
    const records = [
      record('a1', '2026-03-01', 'Hadir'),
      record('a3', '2026-03-10', 'Hadir'),
      record('a2', '2026-03-05', 'Hadir'),
    ];
    const result = summarizeAttendance(records, 's1');
    expect(result.history.map((h: any) => h.date)).toEqual(['2026-03-10', '2026-03-05', '2026-03-01']);
  });
});

describe('buildMonthlyRates — grafik kehadiran per bulan', () => {
  it('mengelompokkan per bulan dan mengurutkan lama -> baru', () => {
    const history = [
      { date: '2026-03-01', status: 'Hadir' },
      { date: '2026-02-01', status: 'Hadir' },
      { date: '2026-02-02', status: 'Alpa' },
    ];
    const result = buildMonthlyRates(history);
    expect(result.map((r) => r.month)).toEqual(['2026-02', '2026-03']);
    expect(result[0].rate).toBe(50);
    expect(result[1].rate).toBe(100);
  });

  it('memberi label bulan dalam bahasa Indonesia', () => {
    const result = buildMonthlyRates([{ date: '2026-08-01', status: 'Hadir' }]);
    expect(result[0].label).toBe('Agu 26');
  });

  it('mengabaikan tanggal yang rusak, bukan ikut menghitungnya', () => {
    const result = buildMonthlyRates([
      { date: '2026-03-01', status: 'Hadir' },
      { date: '', status: 'Hadir' },
      { date: 'bukan-tanggal', status: 'Hadir' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(1);
  });
});

describe('mergeAssignmentsWithSubmissions', () => {
  it('menandai tugas tanpa submission sebagai belum mengumpulkan', () => {
    const result = mergeAssignmentsWithSubmissions(
      [{ id: 'a1', title: 'Tugas 1', dueDate: '2026-03-01' }],
      []
    );
    expect(result[0].status).toBe('belum_mengumpulkan');
    expect(result[0].fileUrl).toBeNull();
  });

  it('memasangkan submission ke tugas yang benar', () => {
    const result = mergeAssignmentsWithSubmissions(
      [
        { id: 'a1', title: 'Tugas 1', dueDate: '2026-03-01' },
        { id: 'a2', title: 'Tugas 2', dueDate: '2026-03-02' },
      ],
      [{ assignmentId: 'a2', status: 'dinilai', textAnswer: 'jawaban', feedback: 'bagus' }]
    );
    expect(result[0].status).toBe('belum_mengumpulkan');
    expect(result[1].status).toBe('dinilai');
    expect(result[1].feedback).toBe('bagus');
  });

  it('mengurutkan berdasarkan tenggat terdekat', () => {
    const result = mergeAssignmentsWithSubmissions(
      [
        { id: 'a1', title: 'Nanti', dueDate: '2026-05-01' },
        { id: 'a2', title: 'Segera', dueDate: '2026-03-01' },
      ],
      []
    );
    expect(result.map((r: any) => r.title)).toEqual(['Segera', 'Nanti']);
  });
});

describe('buildPortfolio', () => {
  it('hanya memuat tugas yang sudah dinilai', () => {
    const assignments = [
      { id: 'a1', title: 'Sudah', status: 'dinilai', gradeColumnId: 'c1', dueDate: '2026-03-01' },
      { id: 'a2', title: 'Menunggu', status: 'menunggu_penilaian', gradeColumnId: 'c2', dueDate: '2026-03-02' },
      { id: 'a3', title: 'Belum', status: 'belum_mengumpulkan', gradeColumnId: 'c3', dueDate: '2026-03-03' },
    ];
    const result = buildPortfolio(assignments, [{ columnId: 'c1', score: '88' }]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Sudah');
    expect(result[0].score).toBe('88');
  });

  it('menampilkan skor null kalau kolom nilainya belum terisi', () => {
    const assignments = [
      { id: 'a1', title: 'Sudah', status: 'dinilai', gradeColumnId: 'c1', dueDate: '2026-03-01' },
    ];
    const result = buildPortfolio(assignments, []);
    expect(result[0].score).toBeNull();
  });

  it('tidak tertukar skor antar tugas', () => {
    const assignments = [
      { id: 'a1', title: 'Satu', status: 'dinilai', gradeColumnId: 'c1', dueDate: '2026-03-01' },
      { id: 'a2', title: 'Dua', status: 'dinilai', gradeColumnId: 'c2', dueDate: '2026-03-02' },
    ];
    const result = buildPortfolio(assignments, [
      { columnId: 'c1', score: '70' },
      { columnId: 'c2', score: '95' },
    ]);
    const byTitle = Object.fromEntries(result.map((r: any) => [r.title, r.score]));
    expect(byTitle).toEqual({ Satu: '70', Dua: '95' });
  });
});

describe('groupScheduleByDay', () => {
  it('mengelompokkan jadwal per hari sekolah', () => {
    const result = groupScheduleByDay([
      { id: '1', day: 'Senin', timeSlot: '09:00' },
      { id: '2', day: 'Senin', timeSlot: '07:00' },
      { id: '3', day: 'Rabu', timeSlot: '08:00' },
    ]);
    const senin = result.find((d) => d.day === 'Senin');
    expect(senin?.items.map((i: any) => i.timeSlot)).toEqual(['07:00', '09:00']);
    expect(result.find((d) => d.day === 'Selasa')?.items).toHaveLength(0);
  });
});
