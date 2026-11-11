import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICES, estimateCost, formatNumber, transferSeconds, type UsageProfile } from '../scripts/loadtest/costModel';
import { flagFor, renderMarkdown, type ScenarioResult } from '../scripts/loadtest/report';
import { LARGE_SCHOOL, scaled } from '../scripts/loadtest/seed';

const usage: UsageProfile = {
  teachers: 10, students: 100, schoolDaysPerMonth: 20, studentActiveRate: 0.5,
  teacherOpensPerDay: { a: 2, b: 1 }, studentOpensPerDay: { c: 3 },
  teacherWritesPerDay: 10, studentWritesPerDay: 1,
};
const scenarios = [{ name: 'a', reads: 100 }, { name: 'b', reads: 50 }, { name: 'c', reads: 20 }];

describe('estimateCost', () => {
  it('menghitung bacaan/hari dari bacaan per alur × frekuensi × jumlah pengguna aktif', () => {
    const e = estimateCost(scenarios, usage);
    // guru: a 100*2*10=2000, b 50*1*10=500; siswa: c 20*3*100*0.5=3000
    expect(e.readsPerDay).toBe(5500);
    expect(e.breakdown.map((b) => [b.name, b.actor, b.readsPerDay])).toEqual([['c', 'siswa', 3000], ['a', 'guru', 2000], ['b', 'guru', 500]]);
    expect(e.breakdown.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 10);
  });

  it('tulisan/hari = guru × tulisan + siswa aktif × tulisan; biaya bulanan sesuai harga per 100 ribu', () => {
    const e = estimateCost(scenarios, usage, { ...DEFAULT_PRICES, readPer100k: 0.06, writePer100k: 0.18, usdIdr: 16000 });
    expect(e.writesPerDay).toBe(10 * 10 + 100 * 0.5 * 1);
    expect(e.readsPerMonth).toBe(5500 * 20);
    expect(e.readCostUsd).toBeCloseTo((110_000 / 100_000) * 0.06, 10);
    expect(e.writeCostUsd).toBeCloseTo(((150 * 20) / 100_000) * 0.18, 10);
    expect(e.totalIdr).toBeCloseTo(e.totalUsd * 16000, 6);
  });

  it('harga dapat diganti; kuota gratis harian hanya menandai bacaan yang melewatinya', () => {
    const cheap = estimateCost(scenarios, usage, { ...DEFAULT_PRICES, readPer100k: 0, writePer100k: 0 });
    expect(cheap.totalUsd).toBe(0);
    expect(estimateCost(scenarios, usage).billableReadsPerDay).toBe(0); // 5.500 < 50.000
    expect(estimateCost(scenarios, { ...usage, teachers: 200 }).billableReadsPerDay).toBeGreaterThan(0);
  });

  it('alur tanpa data bacaan dihitung 0, tidak membuat NaN', () => {
    const e = estimateCost([], usage);
    expect(e.readsPerDay).toBe(0);
    expect(Number.isNaN(e.totalUsd)).toBe(false);
    expect(e.breakdown.every((b) => b.share === 0)).toBe(true);
  });
});

describe('util', () => {
  it('transferSeconds: bytes → detik pada kbps tertentu; kbps 0 aman', () => {
    expect(transferSeconds(187_500, 1500)).toBeCloseTo(1, 10); // 1,5 Mb dalam 1 dtk pada 1500 kbps
    expect(transferSeconds(100, 0)).toBe(0);
  });
  it('flagFor memberi tanda berat pada ambang 500 dan 2000 bacaan', () => {
    expect(flagFor(499)).toBe('');
    expect(flagFor(500)).toBe('berat');
    expect(flagFor(2000)).toBe('sangat berat');
  });
  it('formatNumber memakai pemisah ribuan Indonesia', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
  });
  it('scaled: skala mengecilkan kelas/guru/hari tetapi menjaga minimum yang masuk akal', () => {
    const s = scaled(LARGE_SCHOOL, 0.01);
    expect(s.classes).toBeGreaterThanOrEqual(2);
    expect(s.schoolDays).toBeGreaterThanOrEqual(10);
    expect(scaled(LARGE_SCHOOL, 1)).toEqual(LARGE_SCHOOL);
  });
});

describe('renderMarkdown', () => {
  const results: ScenarioResult[] = [
    { name: 'a', actor: 'guru', label: 'Guru: A', reads: 2500, docs: 2400, bytes: 3_000_000, ms: 800, queries: 3 },
    { name: 'b', actor: 'guru', label: 'Guru: B', reads: 50, docs: 50, bytes: 4000, ms: 10, queries: 1 },
    { name: 'c', actor: 'siswa', label: 'Siswa: C', reads: 20, docs: 20, bytes: 2000, ms: 9, queries: 1 },
  ];
  const md = renderMarkdown({ size: LARGE_SCHOOL, totalDocs: 96000, docsByCollection: { grades: 15552, students: 1296 }, results, usage, prices: DEFAULT_PRICES, networkKbps: 1500, scale: 1, generatedAt: '2026-11-09' });

  it('memuat peringatan cara membaca (waktu emulator, harga perkiraan), tabel alur, estimasi bulanan, dan temuan alur berat', () => {
    expect(md).toContain('Waktu (ms) berasal dari emulator lokal');
    expect(md).toContain('verifikasi dengan halaman harga Firestore');
    expect(md).toContain('| Guru: A | guru | 2.500 |');
    expect(md).toContain('Total Firestore');
    expect(md).toContain('## Temuan (alur berat)');
    expect(md).toContain('**Guru: A**');
    expect(md).not.toMatch(/\*\*Guru: B\*\*/); // alur ringan tidak masuk temuan
  });
  it('perkiraan unduh dihitung dari ukuran data (3 MB @1500 kbps = 16,0 dtk)', () => {
    expect(md).toContain('| 16.0 |');
  });
});
