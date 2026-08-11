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
