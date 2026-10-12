import { describe, expect, it } from 'vitest';
import { parseScore, summarizeAttendanceByClass, summarizeGradesByStudent } from '../lib/utils/exportSummary';

const att = (className: string, date: string, subject: string, status: string, late = '-') => ({ className, date, subject, studentName: 'x', nis: '1', status, late });

describe('ringkasan presensi per kelas', () => {
  it('sesi unik, status, terlambat, dan % hadir = Hadir ÷ semua catatan (izin/sakit/dispensasi/alpa ikut penyebut)', () => {
    const rows = [
      att('7A', '2026-03-01', 'IPA', 'Hadir'), att('7A', '2026-03-01', 'IPA', 'Hadir', 'Ya'), att('7A', '2026-03-01', 'IPA', 'Izin'),
      att('7A', '2026-03-02', 'IPA', 'Sakit'), att('7A', '2026-03-02', 'IPA', 'Dispensasi'), att('7A', '2026-03-02', 'IPA', 'Alpa'),
      att('7B', '2026-03-01', 'IPS', 'Hadir'),
    ];
    const [a, b] = summarizeAttendanceByClass(rows);
    expect(a).toEqual({ className: '7A', sessions: 2, total: 6, hadir: 2, izin: 1, sakit: 1, alpha: 1, dispensasi: 1, terlambat: 1, hadirPercent: '33%' });
    expect(b).toMatchObject({ className: '7B', sessions: 1, total: 1, hadir: 1, hadirPercent: '100%' });
  });
  it('kosong → tidak ada baris (bukan NaN); kelas diurutkan; huruf besar/kecil & spasi pada status ditoleransi', () => {
    expect(summarizeAttendanceByClass([])).toEqual([]);
    const r = summarizeAttendanceByClass([att('8A', 'd', 's', ' HADIR '), att('7A', 'd', 's', 'alpa')]);
    expect(r.map((x) => x.className)).toEqual(['7A', '8A']);
    expect(r[1].hadir).toBe(1); expect(r[0].alpha).toBe(1);
  });
  it('KETERBATASAN terdokumentasi: dua sesi mapel sama di tanggal sama dihitung satu sesi, tetapi catatan siswa & % hadir tetap benar', () => {
    const rows = [att('7A', '2026-03-01', 'IPA', 'Hadir'), att('7A', '2026-03-01', 'IPA', 'Alpa'), att('7A', '2026-03-01', 'IPA', 'Hadir'), att('7A', '2026-03-01', 'IPA', 'Hadir')];
    const [r] = summarizeAttendanceByClass(rows);
    expect(r.sessions).toBe(1); // bisa jadi 2 sesi nyata; sumber baris tidak membawa ID sesi
    expect(r).toMatchObject({ total: 4, hadir: 3, hadirPercent: '75%' });
  });
  it('tidak mengubah baris sumber', () => {
    const rows = [att('7A', 'd', 's', 'Hadir', 'Ya')];
    const snap = JSON.stringify(rows);
    summarizeAttendanceByClass(rows);
    expect(JSON.stringify(rows)).toBe(snap);
  });
});

describe('parseScore', () => {
  it('angka valid diterima; kosong/spasi/null/teks/boolean/NaN BUKAN 0', () => {
    expect(parseScore(80)).toBe(80); expect(parseScore('85')).toBe(85); expect(parseScore(' 85,5 ')).toBe(85.5); expect(parseScore('0')).toBe(0); expect(parseScore(0)).toBe(0);
    for (const bad of ['', '   ', null, undefined, 'abc', '8a', true, false, NaN, Infinity, '1e3', '--1', {}, []]) expect(parseScore(bad), String(bad)).toBeNull();
  });
});

describe('ringkasan nilai per siswa', () => {
  const g = (studentName: string, score: unknown, className = '7A') => ({ className, studentName, nis: '1', columnTitle: 'T', columnType: 'Tugas', score });
  it('jumlah terisi, rata-rata, tertinggi, terendah; nilai kosong/non-angka diabaikan dan tidak menurunkan rata-rata', () => {
    const rows = [g('Ani', 80), g('Ani', '90'), g('Ani', ''), g('Ani', '   '), g('Ani', null), g('Ani', 'abc'), g('Ani', '70,5'), g('Budi', 'abc')];
    const r = summarizeGradesByStudent(rows);
    expect(r).toEqual([{ className: '7A', studentName: 'Ani', nis: '1', components: 3, average: 80.17, highest: 90, lowest: 70.5 }]);
  });
  it('nilai 0 yang sungguhan dihitung; siswa berbeda/kelas berbeda tidak tercampur; urut kelas lalu nama', () => {
    const r = summarizeGradesByStudent([g('Citra', 0, '7B'), g('Budi', 50, '7A'), g('Ani', 100, '7A'), g('Ani', 0, '7A')]);
    expect(r.map((x) => `${x.className}/${x.studentName}`)).toEqual(['7A/Ani', '7A/Budi', '7B/Citra']);
    expect(r[0]).toMatchObject({ components: 2, average: 50, highest: 100, lowest: 0 });
    expect(r[2]).toMatchObject({ components: 1, average: 0, highest: 0, lowest: 0 });
  });
  it('tidak mengubah baris sumber (rincian tetap utuh dengan nilai aslinya)', () => {
    const rows = [g('Ani', ''), g('Ani', '85')];
    const snap = JSON.stringify(rows);
    summarizeGradesByStudent(rows);
    expect(JSON.stringify(rows)).toBe(snap);
  });
});
