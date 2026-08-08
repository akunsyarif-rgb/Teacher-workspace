import { describe, expect, it } from 'vitest';
import { buildInsights, THRESHOLDS } from '../lib/utils/insights';

// buildInsights sengaja murni (data masuk -> temuan keluar), jadi seluruh
// aturan ambang batasnya bisa diuji tanpa Firestore maupun emulator.
// Ini jenis logika yang paling mudah salah diam-diam: satu tanda banding
// terbalik dan guru diarahkan ke siswa yang salah.

const TODAY = '2026-03-20';

function attendanceRecord(overrides: Partial<any> = {}) {
  return {
    id: 'att1',
    className: 'XI-A',
    date: '2026-03-10',
    details: [],
    ...overrides,
  };
}

function detail(studentId: string, status: string, name = 'Budi') {
  return { studentId, name, status };
}

// Membuat N pertemuan dengan status yang sama untuk satu siswa.
function sessions(count: number, status: string, studentId = 's1') {
  return Array.from({ length: count }, (_, i) =>
    attendanceRecord({
      id: `att${i}`,
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      details: [detail(studentId, status)],
    })
  );
}

const EMPTY = { students: [], attendances: [], journals: [], assignments: [], submissions: [], today: TODAY };

describe('buildInsights — kehadiran', () => {
  it('tidak menandai siswa yang kehadirannya penuh', () => {
    const result = buildInsights({ ...EMPTY, attendances: sessions(10, 'Hadir') });
    expect(result.filter((i) => i.category === 'kehadiran')).toHaveLength(0);
  });

  it('tidak menandai apa pun kalau pertemuannya belum cukup untuk bermakna', () => {
    // 1 dari 2 hadir = 50%, di bawah ambang — tapi 2 pertemuan belum
    // menunjukkan pola apa pun, jadi tidak boleh dilaporkan.
    const attendances = [
      attendanceRecord({ id: 'a1', date: '2026-03-01', details: [detail('s1', 'Hadir')] }),
      attendanceRecord({ id: 'a2', date: '2026-03-02', details: [detail('s1', 'Sakit')] }),
    ];
    const result = buildInsights({ ...EMPTY, attendances });
    expect(result.filter((i) => i.category === 'kehadiran')).toHaveLength(0);
  });

  it('menandai siswa dengan kehadiran di bawah ambang setelah cukup pertemuan', () => {
    // 5 hadir dari 10 = 50%
    const attendances = [...sessions(5, 'Hadir'), ...sessions(5, 'Sakit').map((r, i) => ({ ...r, id: `s${i}` }))];
    const result = buildInsights({ ...EMPTY, attendances });
    const kehadiran = result.filter((i) => i.category === 'kehadiran');
    expect(kehadiran).toHaveLength(1);
    expect(kehadiran[0].detail).toContain('50%');
  });

  it('menandai siswa dengan alpa berulang walau persentasenya masih di atas ambang', () => {
    // 17 hadir + 3 alpa = 85% (di atas ambang 80%), tapi 3 alpa layak
    // ditindaklanjuti — ini kasus yang paling mudah terlewat.
    const attendances = [
      ...sessions(17, 'Hadir'),
      ...Array.from({ length: 3 }, (_, i) =>
        attendanceRecord({ id: `alpa${i}`, date: `2026-03-2${i}`, details: [detail('s1', 'Alpa')] })
      ),
    ];
    const result = buildInsights({ ...EMPTY, attendances });
    const kehadiran = result.filter((i) => i.category === 'kehadiran');
    expect(kehadiran).toHaveLength(1);
    expect(kehadiran[0].detail).toContain('alpa 3 kali');
    expect(kehadiran[0].recommendation).toContain('orang tua');
  });

  it('memisahkan rekap antar siswa, tidak mencampur', () => {
    const attendances = Array.from({ length: 10 }, (_, i) =>
      attendanceRecord({
        id: `a${i}`,
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        details: [detail('rajin', 'Hadir', 'Ani'), detail('bolos', 'Alpa', 'Doni')],
      })
    );
    const result = buildInsights({ ...EMPTY, attendances });
    const kehadiran = result.filter((i) => i.category === 'kehadiran');
    expect(kehadiran).toHaveLength(1);
    expect(kehadiran[0].title).toContain('Doni');
  });
});

describe('buildInsights — tugas', () => {
  const students = [
    { id: 's1', className: 'XI-A' },
    { id: 's2', className: 'XI-A' },
    { id: 's3', className: 'XI-A' },
    { id: 's4', className: 'XI-A' },
  ];

  it('tidak melaporkan tugas yang belum lewat tenggat', () => {
    const result = buildInsights({
      ...EMPTY,
      students,
      assignments: [{ id: 'a1', title: 'Tugas 1', className: 'XI-A', dueDate: '2026-04-01' }],
      submissions: [],
    });
    expect(result.filter((i) => i.category === 'tugas')).toHaveLength(0);
  });

  it('melaporkan tugas lewat tenggat yang pengumpulannya rendah', () => {
    const result = buildInsights({
      ...EMPTY,
      students,
      assignments: [{ id: 'a1', title: 'Tugas 1', className: 'XI-A', dueDate: '2026-03-10' }],
      submissions: [{ assignmentId: 'a1', studentId: 's1' }],
    });
    const tugas = result.filter((i) => i.category === 'tugas');
    expect(tugas).toHaveLength(1);
    expect(tugas[0].detail).toContain('1 dari 4');
  });

  it('tidak melaporkan tugas yang pengumpulannya sudah memadai', () => {
    const result = buildInsights({
      ...EMPTY,
      students,
      assignments: [{ id: 'a1', title: 'Tugas 1', className: 'XI-A', dueDate: '2026-03-10' }],
      submissions: [
        { assignmentId: 'a1', studentId: 's1' },
        { assignmentId: 'a1', studentId: 's2' },
        { assignmentId: 'a1', studentId: 's3' },
      ],
    });
    expect(result.filter((i) => i.category === 'tugas')).toHaveLength(0);
  });

  it('tidak membagi dengan nol saat kelasnya belum punya siswa', () => {
    const result = buildInsights({
      ...EMPTY,
      students: [],
      assignments: [{ id: 'a1', title: 'Tugas 1', className: 'XII-B', dueDate: '2026-03-10' }],
      submissions: [],
    });
    expect(result.filter((i) => i.category === 'tugas')).toHaveLength(0);
  });

  it('tidak mencampur pengumpulan antar tugas', () => {
    const result = buildInsights({
      ...EMPTY,
      students,
      assignments: [
        { id: 'a1', title: 'Tugas 1', className: 'XI-A', dueDate: '2026-03-10' },
        { id: 'a2', title: 'Tugas 2', className: 'XI-A', dueDate: '2026-03-11' },
      ],
      submissions: [
        { assignmentId: 'a1', studentId: 's1' },
        { assignmentId: 'a1', studentId: 's2' },
        { assignmentId: 'a1', studentId: 's3' },
        { assignmentId: 'a1', studentId: 's4' },
      ],
    });
    const tugas = result.filter((i) => i.category === 'tugas');
    expect(tugas).toHaveLength(1);
    expect(tugas[0].title).toContain('Tugas 2');
  });
});

describe('buildInsights — administrasi', () => {
  it('melaporkan presensi yang jurnalnya belum diisi', () => {
    const result = buildInsights({
      ...EMPTY,
      attendances: [attendanceRecord({ id: 'a1', className: 'XI-A', date: '2026-03-10' })],
      journals: [],
    });
    const admin = result.filter((i) => i.category === 'administrasi');
    expect(admin).toHaveLength(1);
    expect(admin[0].title).toContain('XI-A');
  });

  it('tidak melaporkan kalau jurnal untuk kelas dan tanggal itu sudah ada', () => {
    const result = buildInsights({
      ...EMPTY,
      attendances: [attendanceRecord({ id: 'a1', className: 'XI-A', date: '2026-03-10' })],
      journals: [{ className: 'XI-A', date: '2026-03-10' }],
    });
    expect(result.filter((i) => i.category === 'administrasi')).toHaveLength(0);
  });

  it('mencocokkan per kelas DAN tanggal, bukan salah satunya saja', () => {
    const result = buildInsights({
      ...EMPTY,
      attendances: [attendanceRecord({ id: 'a1', className: 'XI-A', date: '2026-03-10' })],
      // Jurnal ada di kelas sama tapi tanggal berbeda — tidak boleh
      // dianggap menutup kewajiban tanggal 10.
      journals: [{ className: 'XI-A', date: '2026-03-11' }],
    });
    expect(result.filter((i) => i.category === 'administrasi')).toHaveLength(1);
  });
});

describe('buildInsights — urutan & ambang', () => {
  it('menaruh temuan mendesak di urutan atas', () => {
    const result = buildInsights({
      ...EMPTY,
      // Kehadiran 0% -> severity tinggi
      attendances: [
        ...sessions(10, 'Sakit'),
        attendanceRecord({ id: 'lain', className: 'XII-B', date: '2026-03-15', details: [] }),
      ],
      journals: [],
    });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].severity).toBe('tinggi');
  });

  it('mengembalikan daftar kosong saat tidak ada data sama sekali', () => {
    expect(buildInsights(EMPTY)).toEqual([]);
  });

  it('ambang batas terdokumentasi dan masuk akal', () => {
    expect(THRESHOLDS.LOW_ATTENDANCE_RATE).toBeGreaterThan(0);
    expect(THRESHOLDS.LOW_ATTENDANCE_RATE).toBeLessThanOrEqual(100);
    expect(THRESHOLDS.MIN_SESSIONS_FOR_RATE).toBeGreaterThan(1);
  });
});
