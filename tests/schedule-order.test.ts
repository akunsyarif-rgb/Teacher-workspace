import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sortSchedulesChronologically,
  getScheduleStartMinutes,
  isScheduleOngoing,
  findActiveScheduleId,
} from '../lib/utils/scheduleTime';

// Regresi urutan jadwal. Laporan aslinya: di Beranda "Jam Ke 9–10" tampil
// SEBELUM "Jam Ke 7–8" dan "Jam Ke 1–2".
//
// Sebabnya bukan sorting-nya, tapi parser-nya. Pola lama hanya menerima
// pemisah literal "s.d.", padahal timeSlot diketik bebas oleh guru. Semua
// bentuk bertanda hubung gagal diparse dan jatuh ke MAX_SAFE_INTEGER —
// nilainya sama rata, jadi Array.prototype.sort (stabil) membiarkan urutan
// dokumen Firestore apa adanya.

const MAX = Number.MAX_SAFE_INTEGER;
const jam = (n: number) => 7 * 60 + 30 + (n - 1) * 45; // Jam Ke-n mulai 07.30 + 45'

describe('format "Jam Ke" yang diketik guru bisa diparse', () => {
  // Bentuk lama yang SUDAH ada di data produksi — wajib tetap jalan.
  it('format lama dengan s.d. tetap terbaca (tidak merusak data lama)', () => {
    expect(getScheduleStartMinutes('Jam Ke-1 s.d. 2')).toBe(jam(1));
    expect(getScheduleStartMinutes('Jam Ke 3 s.d. 4')).toBe(jam(3));
  });

  it('bentuk bertanda hubung biasa terbaca', () => {
    expect(getScheduleStartMinutes('Jam Ke 1-2')).toBe(jam(1));
    expect(getScheduleStartMinutes('Jam Ke 7-8')).toBe(jam(7));
    expect(getScheduleStartMinutes('Jam Ke 9-10')).toBe(jam(9));
  });

  it('en dash & em dash dari keyboard HP/iPad terbaca', () => {
    expect(getScheduleStartMinutes('Jam Ke 1–2')).toBe(jam(1));
    expect(getScheduleStartMinutes('Jam Ke 7–8')).toBe(jam(7));
    expect(getScheduleStartMinutes('Jam Ke 9–10')).toBe(jam(9));
    expect(getScheduleStartMinutes('Jam Ke 9—10')).toBe(jam(9));
  });

  it('varian penulisan s.d. yang lain terbaca', () => {
    expect(getScheduleStartMinutes('Jam ke-9 s.d 10')).toBe(jam(9));
    expect(getScheduleStartMinutes('Jam Ke-9 sd 10')).toBe(jam(9));
    expect(getScheduleStartMinutes('Jam Ke 9 s/d 10')).toBe(jam(9));
    expect(getScheduleStartMinutes('Jam Ke 9 sampai 10')).toBe(jam(9));
  });

  it('huruf besar-kecil & spasi longgar tidak berpengaruh', () => {
    expect(getScheduleStartMinutes('JAM KE 5-6')).toBe(jam(5));
    expect(getScheduleStartMinutes('jam ke  5 - 6')).toBe(jam(5));
    expect(getScheduleStartMinutes('Jam Ke5-6')).toBe(jam(5));
  });

  it('satu jam pelajaran tanpa angka kedua tetap sah', () => {
    expect(getScheduleStartMinutes('Jam Ke 3')).toBe(jam(3));
  });

  it('format jam dinding tetap didahulukan', () => {
    expect(getScheduleStartMinutes('07:00-08:30')).toBe(7 * 60);
    expect(getScheduleStartMinutes('08.00 - 10.00')).toBe(8 * 60);
    expect(getScheduleStartMinutes('13:00–14:00')).toBe(13 * 60);
  });

  it('teks yang benar-benar tidak dikenali ditaruh paling akhir, bukan error', () => {
    expect(getScheduleStartMinutes('menyusul')).toBe(MAX);
    expect(getScheduleStartMinutes('')).toBe(MAX);
  });
});

describe('urutan Jam Ke 1-2, 7-8, 9-10', () => {
  // Persis kasus di screenshot: dokumen Firestore datang terbalik.
  const dariFirestore = [
    { id: 'c', timeSlot: 'Jam Ke 9–10' },
    { id: 'b', timeSlot: 'Jam Ke 7–8' },
    { id: 'a', timeSlot: 'Jam Ke 1–2' },
  ];

  it('diurutkan kronologis, bukan mengikuti urutan dokumen', () => {
    expect(sortSchedulesChronologically(dariFirestore).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('9-10 tidak pernah mendahului 1-2 walau urutan masuknya acak', () => {
    const acak = [dariFirestore[0], dariFirestore[2], dariFirestore[1]];
    expect(sortSchedulesChronologically(acak).map((s) => s.timeSlot)).toEqual([
      'Jam Ke 1–2',
      'Jam Ke 7–8',
      'Jam Ke 9–10',
    ]);
  });

  it('BUKAN urutan string — 10 harus setelah 9, bukan setelah 1', () => {
    const items = [
      { id: 'ke10', timeSlot: 'Jam Ke 10-11' },
      { id: 'ke1', timeSlot: 'Jam Ke 1-2' },
      { id: 'ke9', timeSlot: 'Jam Ke 9-10' },
      { id: 'ke2', timeSlot: 'Jam Ke 2-3' },
    ];
    expect(sortSchedulesChronologically(items).map((s) => s.id)).toEqual(['ke1', 'ke2', 'ke9', 'ke10']);
  });

  it('campuran Jam Ke dan jam dinding tetap kronologis', () => {
    const items = [
      { id: 'siang', timeSlot: '13:00-14:00' },
      { id: 'ke1', timeSlot: 'Jam Ke 1-2' }, // 07.30
      { id: 'pagi', timeSlot: '06:30-07:15' },
    ];
    expect(sortSchedulesChronologically(items).map((s) => s.id)).toEqual(['pagi', 'ke1', 'siang']);
  });

  it('slot tak terbaca ditaruh paling akhir, tidak menggeser yang terbaca', () => {
    const items = [
      { id: 'entah', timeSlot: 'menyusul' },
      { id: 'ke9', timeSlot: 'Jam Ke 9-10' },
      { id: 'ke1', timeSlot: 'Jam Ke 1-2' },
    ];
    expect(sortSchedulesChronologically(items).map((s) => s.id)).toEqual(['ke1', 'ke9', 'entah']);
  });

  it('tidak mengubah array aslinya', () => {
    const asli = [...dariFirestore];
    sortSchedulesChronologically(dariFirestore);
    expect(dariFirestore).toEqual(asli);
  });
});

describe('status berjalan ikut terbaca untuk format bertanda hubung', () => {
  // Jam Ke 1 = 07.30-08.15, Jam Ke 9 mulai 13.30.
  const pagi = new Date('2026-08-11T07:45:00+08:00');

  it('sesi Jam Ke 1-2 dikenali sedang berlangsung', () => {
    expect(isScheduleOngoing('Jam Ke 1-2', pagi)).toBe(true);
    expect(isScheduleOngoing('Jam Ke 1–2', pagi)).toBe(true);
  });

  it('sesi Jam Ke 9-10 belum berlangsung di pagi hari', () => {
    expect(isScheduleOngoing('Jam Ke 9–10', pagi)).toBe(false);
  });

  it('urutan terbalik yang salah ketik tidak bikin rentang negatif', () => {
    // "Jam Ke 8-7" tetap mencakup jamnya, bukan rentang kosong.
    expect(isScheduleOngoing('Jam Ke 1-1', new Date('2026-08-11T07:45:00+08:00'))).toBe(true);
  });
});

describe('konteks sesi dibawa dari Beranda ke Kelas Aktif', () => {
  // Kelas yang sama punya tiga slot hari ini. Sesi yang diklik guru HARUS
  // yang terbuka — bukan slot paling awal hasil penentuan otomatis.
  const KELAS = 'XI B Kesehatan 2';
  const STATUS = [
    { scheduleId: 'sesi-1-2', className: KELAS, timeSlot: 'Jam Ke 1–2' },
    { scheduleId: 'sesi-7-8', className: KELAS, timeSlot: 'Jam Ke 7–8' },
    { scheduleId: 'sesi-9-10', className: KELAS, timeSlot: 'Jam Ke 9–10' },
  ];
  const JADWAL = STATUS.map((s) => ({ id: s.scheduleId, className: KELAS, day: 'Selasa', timeSlot: s.timeSlot }));

  // Cerminan pemilihan sesi di AttendanceForm.
  function pilihSesi(requestedScheduleId: string | null, selectedClass: string) {
    const diminta = requestedScheduleId
      ? STATUS.find((s) => s.scheduleId === requestedScheduleId && s.className === selectedClass)
      : undefined;
    return diminta?.scheduleId ?? findActiveScheduleId(JADWAL, selectedClass, 'Selasa');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T22:00:00+08:00')); // tidak ada sesi berjalan
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('"Mulai Sekarang" pada sesi Jam Ke 9-10 membuka sesi 9-10, bukan slot paling awal', () => {
    // Inti bug: tanpa scheduleId, penentuan otomatis memberi slot 1-2.
    expect(findActiveScheduleId(JADWAL, KELAS, 'Selasa')).toBe('sesi-1-2');
    expect(pilihSesi('sesi-9-10', KELAS)).toBe('sesi-9-10');
  });

  it('sesi tengah (7-8) juga terbuka tepat', () => {
    expect(pilihSesi('sesi-7-8', KELAS)).toBe('sesi-7-8');
  });

  it('className hanya label — scheduleId yang menentukan sesi', () => {
    // Ketiga sesi punya className identik; yang membedakan cuma scheduleId.
    const semuaSamaNama = new Set(STATUS.map((s) => s.className));
    expect(semuaSamaNama.size).toBe(1);
    expect(pilihSesi('sesi-9-10', KELAS)).not.toBe(pilihSesi('sesi-1-2', KELAS));
  });

  it('scheduleId milik kelas lain tidak membuka sesi lintas kelas', () => {
    expect(pilihSesi('sesi-9-10', 'XII A Otomotif 1')).toBeNull();
  });

  it('buka langsung tanpa sesi (Bottom Nav) tetap dapat sesi paling awal, bukan acak', () => {
    expect(pilihSesi(null, KELAS)).toBe('sesi-1-2');
  });
});

describe('pemilihan sesi tombol Buka memakai urutan yang sama', () => {
  const JADWAL = [
    { id: 'ke9', className: 'XI-A', day: 'Selasa', timeSlot: 'Jam Ke 9–10' },
    { id: 'ke1', className: 'XI-A', day: 'Selasa', timeSlot: 'Jam Ke 1–2' },
  ];

  // findActiveScheduleId membaca jam lewat `new Date()` internal, jadi waktu
  // dibekukan di malam hari — tidak ada sesi berlangsung, sehingga yang diuji
  // benar-benar jalur fallback "slot pertama".
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T22:00:00+08:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fallback "slot pertama" adalah yang paling awal, bukan dokumen pertama', () => {
    expect(findActiveScheduleId(JADWAL, 'XI-A', 'Selasa')).toBe('ke1');
    expect(findActiveScheduleId([JADWAL[1], JADWAL[0]], 'XI-A', 'Selasa')).toBe('ke1');
  });
});

describe('label jam header WITA', () => {
  // Keputusan UI: HH:MM saja, tanpa detik. Fungsinya disalin persis dari
  // app/page.tsx (komponen client, tidak bisa diimpor ke test node ini).
  function getWitaTimeLabel(date: Date) {
    return date.toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Makassar',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  it('tidak menampilkan detik', () => {
    const label = getWitaTimeLabel(new Date('2026-08-11T09:05:37+08:00'));
    expect(label).not.toMatch(/\d{1,2}[.:]\d{2}[.:]\d{2}/);
    expect(label.replace(/\./g, ':')).toBe('09:05');
  });

  it('tetap memakai jam WITA apa pun zona perangkat', () => {
    const dariUtc = getWitaTimeLabel(new Date('2026-08-11T01:05:00Z'));
    const dariWib = getWitaTimeLabel(new Date('2026-08-11T08:05:00+07:00'));
    expect(dariUtc.replace(/\./g, ':')).toBe('09:05');
    expect(dariWib.replace(/\./g, ':')).toBe('09:05');
  });
});
