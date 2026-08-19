import { describe, expect, it } from 'vitest';
import { buildStudentCodesShareText } from '../lib/utils/studentCodesShare';

// Regresi "Salin Semua Kode Siswa": sebelumnya guru harus menyalin kode
// akses satu per satu. Fungsi ini murni (data masuk -> teks keluar), jadi
// diuji tanpa Firestore/browser sama sekali.

describe('buildStudentCodesShareText', () => {
  it('menghasilkan seluruh siswa dalam urutan yang sama seperti input', () => {
    const text = buildStudentCodesShareText('XI A', [
      { name: 'Budi', accessCode: 'AB12CD34' },
      { name: 'Citra', accessCode: 'EF56GH78' },
      { name: 'Dewi', accessCode: 'IJ90KL12' },
    ]);
    const lines = text.split('\n');
    expect(lines).toContain('1. Budi — AB12CD34');
    expect(lines).toContain('2. Citra — EF56GH78');
    expect(lines).toContain('3. Dewi — IJ90KL12');
    // Urutan baris di teks harus persis urutan array input, bukan diacak
    // atau diurutkan ulang (mis. alfabetis) — harus sama dengan urutan yang
    // tampil di layar ClassDetail.
    const urutanNama = lines.filter((l) => /^\d+\. /.test(l)).map((l) => l.split(' — ')[0].split('. ')[1]);
    expect(urutanNama).toEqual(['Budi', 'Citra', 'Dewi']);
  });

  it('tidak ada siswa yang tertinggal — jumlah baris nomor sama dengan jumlah siswa', () => {
    const students = Array.from({ length: 12 }, (_, i) => ({ name: `Siswa ${i + 1}`, accessCode: `CODE${i}` }));
    const text = buildStudentCodesShareText('XI B', students);
    const numberedLines = text.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(numberedLines).toHaveLength(12);
  });

  it('kelas kosong tidak menghasilkan error — tetap mengembalikan teks header yang valid', () => {
    expect(() => buildStudentCodesShareText('XI C', [])).not.toThrow();
    const text = buildStudentCodesShareText('XI C', []);
    expect(text).toContain('DAFTAR AKUN SISWA');
    expect(text).toContain('Kelas: XI C');
    expect(text.split('\n').some((l) => /^\d+\. /.test(l))).toBe(false);
  });

  it('siswa yang belum punya kode akses tetap disertakan (tidak diam-diam hilang)', () => {
    const text = buildStudentCodesShareText('XI D', [
      { name: 'Eka', accessCode: 'ZZ99YY88' },
      { name: 'Fajar' }, // belum ada accessCode sama sekali
    ]);
    const lines = text.split('\n');
    expect(lines).toContain('1. Eka — ZZ99YY88');
    expect(lines.some((l) => l.startsWith('2. Fajar'))).toBe(true);
    expect(lines.find((l) => l.startsWith('2. Fajar'))).toContain('belum ada kode');
  });

  it('satu siswa persis satu baris (tidak digabung/dipecah)', () => {
    const text = buildStudentCodesShareText('XI E', [
      { name: 'Gilang Ramadhan', accessCode: 'AA11BB22' },
    ]);
    const numberedLines = text.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(numberedLines).toHaveLength(1);
    expect(numberedLines[0]).toBe('1. Gilang Ramadhan — AA11BB22');
  });

  it('format header sesuai spesifikasi (judul + nama kelas)', () => {
    const text = buildStudentCodesShareText('XII IPA 1', [{ name: 'Budi', accessCode: 'AB12CD34' }]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('DAFTAR AKUN SISWA');
    expect(lines[1]).toBe('Kelas: XII IPA 1');
  });
});
