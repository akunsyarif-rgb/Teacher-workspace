import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifySessionState,
  resolveCurrentWorkflowStep,
  getScheduleStartMinutes,
  findActiveScheduleId,
} from '../lib/utils/scheduleTime';

// Regresi workflow Beranda/Jadwal. Tiga kondisi yang harus benar bersamaan
// pada TANGGAL YANG SAMA: sesi yang belum mulai (upcoming), sesi yang sedang
// berlangsung (ongoing), dan sesi yang jamnya sudah lewat (past). Aturan
// intinya: sesi yang sudah lewat TIDAK boleh dipilih sebagai "Sesi
// Berikutnya"/"Sedang Berlangsung", tapi juga TIDAK boleh hilang dari
// layar — ia pindah ke kelompok Perlu Konfirmasi supaya masih bisa dibuka
// untuk kroscek.

// 09.00 WITA. Semua jam di bawah dibaca sebagai jam dinding WITA.
const NOW = new Date('2026-08-11T09:00:00+08:00');

type Sesi = { scheduleId: string; timeSlot: string; isDone: boolean };

const SESI_LEWAT: Sesi = { scheduleId: 'lewat', timeSlot: '07:00-08:00', isDone: false };
const SESI_BERLANGSUNG: Sesi = { scheduleId: 'berlangsung', timeSlot: '08:30-09:30', isDone: false };
const SESI_NANTI: Sesi = { scheduleId: 'nanti', timeSlot: '10:00-11:00', isDone: false };
const SESI_NANTI_SORE: Sesi = { scheduleId: 'sore', timeSlot: '13:00-14:00', isDone: false };

// Cerminan pembagian kelompok di app/page.tsx: yang "needs_confirmation"
// keluar dari daftar aktif dan masuk daftar Perlu Konfirmasi.
function bagiKelompok(sesiList: Sesi[], now: Date) {
  const withState = sesiList.map((s) => ({
    ...s,
    sessionState: classifySessionState(s.timeSlot, s.isDone, now),
  }));
  return {
    jadwalHariIni: withState.filter((s) => s.sessionState !== 'needs_confirmation'),
    perluKonfirmasi: withState.filter((s) => s.sessionState === 'needs_confirmation'),
  };
}

describe('1. Sesi upcoming mengikuti urutan jadwal', () => {
  // resolveCurrentWorkflowStep sengaja TIDAK mengurutkan sendiri — ia
  // menerima daftar yang sudah kronologis dari dashboardService (lihat
  // komentar fungsinya). Dua test ini menjaga kedua sisi kontrak itu:
  // urutannya benar-benar dihasilkan di hulu, dan pemilihannya mengikuti
  // urutan tersebut.
  it('dashboardService mengurutkan jadwal berdasarkan jam mulai', () => {
    const urut = [SESI_NANTI_SORE, SESI_LEWAT, SESI_NANTI]
      .slice()
      .sort((a, b) => getScheduleStartMinutes(a.timeSlot) - getScheduleStartMinutes(b.timeSlot))
      .map((s) => s.scheduleId);
    expect(urut).toEqual(['lewat', 'nanti', 'sore']);
  });

  it('sesi berikutnya adalah sesi upcoming paling awal dari daftar terurut', () => {
    const step = resolveCurrentWorkflowStep([SESI_NANTI, SESI_NANTI_SORE], NOW);
    expect(step?.status.scheduleId).toBe('nanti');
    expect(step?.isOngoing).toBe(false);
  });

  it('sesi yang belum mulai berstatus upcoming', () => {
    expect(classifySessionState(SESI_NANTI.timeSlot, false, NOW)).toBe('upcoming');
  });
});

describe('2. Sesi ongoing jadi prioritas aktif', () => {
  it('ongoing menang atas sesi upcoming yang lebih awal di array', () => {
    const step = resolveCurrentWorkflowStep([SESI_NANTI, SESI_BERLANGSUNG], NOW);
    expect(step?.status.scheduleId).toBe('berlangsung');
    expect(step?.isOngoing).toBe(true);
  });

  it('ongoing menang walau ada sesi lewat di daftar', () => {
    const step = resolveCurrentWorkflowStep([SESI_LEWAT, SESI_BERLANGSUNG, SESI_NANTI], NOW);
    expect(step?.status.scheduleId).toBe('berlangsung');
    expect(step?.isOngoing).toBe(true);
  });

  it('sesi yang sedang berjalan berstatus ongoing', () => {
    expect(classifySessionState(SESI_BERLANGSUNG.timeSlot, false, NOW)).toBe('ongoing');
  });
});

describe('3. Sesi yang sudah lewat tidak jadi sesi aktif', () => {
  it('sesi lewat TIDAK dipilih sebagai Sesi Berikutnya walau satu-satunya yang tersisa', () => {
    expect(resolveCurrentWorkflowStep([SESI_LEWAT], NOW)).toBeNull();
  });

  it('sesi lewat dilewati, yang dipilih sesi upcoming berikutnya', () => {
    const step = resolveCurrentWorkflowStep([SESI_LEWAT, SESI_NANTI], NOW);
    expect(step?.status.scheduleId).toBe('nanti');
    expect(step?.isOngoing).toBe(false);
  });

  it('semua sesi hari ini sudah lewat -> tidak ada sesi aktif sama sekali', () => {
    const lewatLain: Sesi = { scheduleId: 'lewat2', timeSlot: '06:00-06:45', isDone: false };
    expect(resolveCurrentWorkflowStep([SESI_LEWAT, lewatLain], NOW)).toBeNull();
  });

  it('sesi lewat tidak masuk daftar Jadwal Hari Ini yang aktif', () => {
    const { jadwalHariIni } = bagiKelompok([SESI_LEWAT, SESI_BERLANGSUNG, SESI_NANTI], NOW);
    expect(jadwalHariIni.map((s) => s.scheduleId)).toEqual(['berlangsung', 'nanti']);
  });
});

describe('4. Sesi lewat pada tanggal yang sama tidak hilang', () => {
  it('sesi lewat yang belum lengkap muncul di Perlu Konfirmasi', () => {
    const { perluKonfirmasi } = bagiKelompok([SESI_LEWAT, SESI_BERLANGSUNG, SESI_NANTI], NOW);
    expect(perluKonfirmasi.map((s) => s.scheduleId)).toEqual(['lewat']);
  });

  it('tidak ada sesi yang menghilang dari kedua kelompok', () => {
    const semua = [SESI_LEWAT, SESI_BERLANGSUNG, SESI_NANTI, SESI_NANTI_SORE];
    const { jadwalHariIni, perluKonfirmasi } = bagiKelompok(semua, NOW);
    const terlihat = [...jadwalHariIni, ...perluKonfirmasi].map((s) => s.scheduleId).sort();
    expect(terlihat).toEqual(semua.map((s) => s.scheduleId).sort());
  });

  it('sesi lewat yang SUDAH lengkap tetap di daftar utama sebagai Selesai', () => {
    const lewatSelesai: Sesi = { ...SESI_LEWAT, isDone: true };
    const { jadwalHariIni, perluKonfirmasi } = bagiKelompok([lewatSelesai], NOW);
    expect(jadwalHariIni.map((s) => s.sessionState)).toEqual(['done']);
    expect(perluKonfirmasi).toHaveLength(0);
  });

  it('sesi lewat yang sudah selesai juga tidak ditarik jadi sesi aktif', () => {
    const lewatSelesai: Sesi = { ...SESI_LEWAT, isDone: true };
    expect(resolveCurrentWorkflowStep([lewatSelesai], NOW)).toBeNull();
  });
});

describe('5. Tombol Buka membuka sesi yang benar', () => {
  // findActiveScheduleId membaca jam lewat `new Date()` internal (tidak
  // menerima parameter `now` seperti fungsi lain di modul ini), jadi waktu
  // WAJIB dibekukan — kalau tidak, test ini berubah hasil saat kebetulan
  // dijalankan di dalam jam salah satu slot di bawah.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Kelas yang sama punya DUA slot di hari yang sama: satu sudah lewat,
  // satu masih nanti. Ini kondisi yang membuat penentuan otomatis tidak
  // cukup — makanya link "Buka" dari Perlu Konfirmasi membawa scheduleId.
  const JADWAL = [
    { id: 'pagi', className: 'XI-A', day: 'Selasa', timeSlot: '07:00-08:00' },
    { id: 'siang', className: 'XI-A', day: 'Selasa', timeSlot: '13:00-14:00' },
  ];
  const STATUS_HARI_INI = [
    { scheduleId: 'pagi', className: 'XI-A' },
    { scheduleId: 'siang', className: 'XI-A' },
  ];

  // Cerminan pemilihan sesi di AttendanceForm: scheduleId dari deep-link
  // menang selama sesinya memang milik kelas itu & ada di jadwal hari ini.
  function pilihSesi(requestedScheduleId: string | null, selectedClass: string) {
    const diminta = requestedScheduleId
      ? STATUS_HARI_INI.find((s) => s.scheduleId === requestedScheduleId && s.className === selectedClass)
      : undefined;
    return diminta?.scheduleId ?? findActiveScheduleId(JADWAL, selectedClass, 'Selasa');
  }

  it('tanpa scheduleId, penentuan otomatis bisa memilih slot yang keliru', () => {
    // Inilah alasan scheduleId dibawa: hasilnya ikut urutan dokumen jadwal,
    // bukan sesi yang diklik guru.
    expect(findActiveScheduleId(JADWAL, 'XI-A', 'Selasa')).toBe('pagi');
    expect(findActiveScheduleId([JADWAL[1], JADWAL[0]], 'XI-A', 'Selasa')).toBe('siang');
  });

  it('scheduleId dari link membuka sesi pagi yang sudah lewat, bukan slot lain', () => {
    expect(pilihSesi('pagi', 'XI-A')).toBe('pagi');
  });

  it('scheduleId dari link membuka sesi siang, bukan slot pertama', () => {
    expect(pilihSesi('siang', 'XI-A')).toBe('siang');
  });

  it('scheduleId basi/tidak dikenal jatuh ke penentuan otomatis, bukan sesi kosong', () => {
    expect(pilihSesi('sudah-dihapus', 'XI-A')).toBe('pagi');
  });

  it('scheduleId milik kelas lain diabaikan — tidak membuka sesi lintas kelas', () => {
    expect(pilihSesi('pagi', 'XII-B')).toBeNull();
  });

  it('tanpa scheduleId perilakunya sama seperti sebelumnya', () => {
    expect(pilihSesi(null, 'XI-A')).toBe('pagi');
  });
});

describe('6. Aturan completion tidak berubah', () => {
  it('status done murni dari isDone, bukan dari jam', () => {
    // Sesi yang sedang berlangsung sekalipun jadi "done" begitu kewajibannya
    // lengkap — dan sebaliknya jam tidak pernah menandai sesi jadi selesai.
    expect(classifySessionState(SESI_BERLANGSUNG.timeSlot, true, NOW)).toBe('done');
    expect(classifySessionState(SESI_LEWAT.timeSlot, false, NOW)).toBe('needs_confirmation');
  });

  it('sesi yang sudah selesai tidak pernah jadi pekerjaan aktif', () => {
    const semuaSelesai = [
      { ...SESI_BERLANGSUNG, isDone: true },
      { ...SESI_NANTI, isDone: true },
    ];
    expect(resolveCurrentWorkflowStep(semuaSelesai, NOW)).toBeNull();
  });
});

describe('7. Seluruh perhitungan memakai WITA', () => {
  // Momen yang sama persis dituliskan dari tiga zona berbeda — hasilnya
  // wajib identik, karena patokannya jam dinding WITA, bukan zona perangkat.
  const samaTapiZonaLain = [
    new Date('2026-08-11T09:00:00+08:00'),
    new Date('2026-08-11T01:00:00Z'),
    new Date('2026-08-11T08:00:00+07:00'),
  ];

  it('status sesi sama dari zona perangkat mana pun', () => {
    samaTapiZonaLain.forEach((now) => {
      expect(classifySessionState(SESI_BERLANGSUNG.timeSlot, false, now)).toBe('ongoing');
      expect(classifySessionState(SESI_LEWAT.timeSlot, false, now)).toBe('needs_confirmation');
      expect(classifySessionState(SESI_NANTI.timeSlot, false, now)).toBe('upcoming');
    });
  });

  it('pemilihan sesi aktif sama dari zona perangkat mana pun', () => {
    samaTapiZonaLain.forEach((now) => {
      const step = resolveCurrentWorkflowStep([SESI_LEWAT, SESI_BERLANGSUNG, SESI_NANTI], now);
      expect(step?.status.scheduleId).toBe('berlangsung');
    });
  });
});

describe('8. Tiga kondisi bersamaan pada hari yang sama', () => {
  it('upcoming, ongoing, dan past terbagi ke kelompok yang benar sekaligus', () => {
    const { jadwalHariIni, perluKonfirmasi } = bagiKelompok(
      [SESI_LEWAT, SESI_BERLANGSUNG, SESI_NANTI],
      NOW
    );

    // Yang aktif: sesi berlangsung + sesi yang belum mulai, urutan terjaga.
    expect(jadwalHariIni.map((s) => [s.scheduleId, s.sessionState])).toEqual([
      ['berlangsung', 'ongoing'],
      ['nanti', 'upcoming'],
    ]);

    // Yang lewat: tetap ada, tapi di kelompok terpisah.
    expect(perluKonfirmasi.map((s) => [s.scheduleId, s.sessionState])).toEqual([
      ['lewat', 'needs_confirmation'],
    ]);

    // Dan yang ditawarkan sebagai pekerjaan sekarang adalah yang berlangsung.
    expect(resolveCurrentWorkflowStep([SESI_LEWAT, SESI_BERLANGSUNG, SESI_NANTI], NOW)?.status.scheduleId).toBe(
      'berlangsung'
    );
  });

  it('setelah sesi berlangsung selesai, giliran sesi berikutnya — bukan sesi lewat', () => {
    const step = resolveCurrentWorkflowStep(
      [SESI_LEWAT, { ...SESI_BERLANGSUNG, isDone: true }, SESI_NANTI],
      NOW
    );
    expect(step?.status.scheduleId).toBe('nanti');
    expect(step?.isOngoing).toBe(false);
  });
});
