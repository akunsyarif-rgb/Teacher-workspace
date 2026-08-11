import { describe, expect, it } from 'vitest';
import {
  getWitaDateString,
  getWitaDayName,
  getWitaMinutesOfDay,
  getWitaDaysAgo,
  shiftWitaDateString,
  shiftWitaMonths,
  getDayNameFromDateString,
} from '../lib/utils/witaDate';
import { classifySessionState, isScheduleOngoing } from '../lib/utils/scheduleTime';

// Regresi untuk bug tanggal UTC: sebelumnya seluruh aplikasi memakai
// `new Date().toISOString().split('T')[0]`, yang mengembalikan tanggal UTC.
// Untuk WITA (UTC+8) tiap kejadian antara 00.00–08.00 tercatat bertanggal
// HARI SEBELUMNYA — persis jam mengajar pagi — sementara nama harinya
// diambil dari zona perangkat yang sudah menunjuk hari baru.

// 07.30 WITA, Selasa 11 Agustus 2026. Dalam UTC ini masih 10 Agustus 23.30.
const PAGI_WITA = new Date('2026-08-11T07:30:00+08:00');

describe('getWitaDateString', () => {
  it('memakai tanggal dinding WITA, bukan tanggal UTC', () => {
    expect(PAGI_WITA.toISOString().split('T')[0]).toBe('2026-08-10');
    expect(getWitaDateString(PAGI_WITA)).toBe('2026-08-11');
  });

  it('konsisten walau perangkat berada di zona waktu lain', () => {
    // Momen yang sama persis, ditulis dari sudut pandang UTC dan WIB.
    const dariUtc = new Date('2026-08-10T23:30:00Z');
    const dariWib = new Date('2026-08-11T06:30:00+07:00');
    expect(getWitaDateString(dariUtc)).toBe('2026-08-11');
    expect(getWitaDateString(dariWib)).toBe('2026-08-11');
  });

  it('tepat pada pergantian hari WITA', () => {
    expect(getWitaDateString(new Date('2026-08-11T23:59:59+08:00'))).toBe('2026-08-11');
    expect(getWitaDateString(new Date('2026-08-12T00:00:00+08:00'))).toBe('2026-08-12');
  });
});

describe('getWitaDayName', () => {
  it('memberi nama hari WITA, bukan hari UTC', () => {
    expect(getWitaDayName(PAGI_WITA)).toBe('Selasa');
  });

  it('tidak tergelincir ke hari sebelumnya pada dini hari WITA', () => {
    expect(getWitaDayName(new Date('2026-08-11T00:30:00+08:00'))).toBe('Selasa');
  });

  it('sepakat dengan tanggal yang dikembalikan getWitaDateString', () => {
    const dini = new Date('2026-08-11T01:00:00+08:00');
    expect(getDayNameFromDateString(getWitaDateString(dini))).toBe(getWitaDayName(dini));
  });
});

describe('getWitaMinutesOfDay', () => {
  it('menghitung menit dari jam dinding WITA', () => {
    expect(getWitaMinutesOfDay(PAGI_WITA)).toBe(7 * 60 + 30);
  });

  it('tengah malam WITA bernilai 0, bukan melompat sehari', () => {
    expect(getWitaMinutesOfDay(new Date('2026-08-11T00:00:00+08:00'))).toBe(0);
  });

  it('sama untuk momen yang sama dari zona perangkat berbeda', () => {
    expect(getWitaMinutesOfDay(new Date('2026-08-11T06:30:00+07:00'))).toBe(7 * 60 + 30);
  });
});

describe('pergeseran tanggal', () => {
  it('shiftWitaDateString melewati batas bulan', () => {
    expect(shiftWitaDateString('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftWitaDateString('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('shiftWitaDateString melewati batas tahun', () => {
    expect(shiftWitaDateString('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('getWitaDaysAgo memakai tanggal WITA sebagai titik awal', () => {
    expect(getWitaDaysAgo(6, PAGI_WITA)).toBe('2026-08-05');
    expect(getWitaDaysAgo(0, PAGI_WITA)).toBe('2026-08-11');
  });

  it('shiftWitaMonths mundur sesuai bulan kalender', () => {
    expect(shiftWitaMonths('2026-08-11', -1)).toBe('2026-07-11');
    expect(shiftWitaMonths('2026-08-11', -6)).toBe('2026-02-11');
  });
});

describe('status sesi memakai jam WITA', () => {
  // Sesi 07.00–08.30: pada 07.30 WITA sesi ini sedang berlangsung. Sebelum
  // perbaikan, perangkat berzona UTC menghitungnya dari pukul 23.30 dan
  // sesi yang sedang berjalan malah dianggap "Perlu Konfirmasi".
  it('sesi berjalan dikenali sebagai ongoing dari zona perangkat mana pun', () => {
    expect(isScheduleOngoing('07:00-08:30', PAGI_WITA)).toBe(true);
    expect(isScheduleOngoing('07:00-08:30', new Date('2026-08-10T23:30:00Z'))).toBe(true);
    expect(classifySessionState('07:00-08:30', false, PAGI_WITA)).toBe('ongoing');
  });

  it('sesi yang belum mulai tetap upcoming', () => {
    expect(classifySessionState('10:00-11:30', false, PAGI_WITA)).toBe('upcoming');
  });

  it('sesi yang jamnya sudah lewat dan belum lengkap jadi needs_confirmation', () => {
    expect(classifySessionState('05:00-06:00', false, PAGI_WITA)).toBe('needs_confirmation');
  });

  it('sesi yang sudah lengkap selalu done', () => {
    expect(classifySessionState('05:00-06:00', true, PAGI_WITA)).toBe('done');
  });

  it('format "Jam Ke-" ikut memakai jam WITA', () => {
    // Jam Ke-1 mulai 07.30, jadi tepat berjalan pada 07.30 WITA.
    expect(isScheduleOngoing('Jam Ke-1 s.d. 2', PAGI_WITA)).toBe(true);
  });
});
