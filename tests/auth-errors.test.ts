import { describe, it, expect } from 'vitest';
import { describeAuthError } from '../lib/utils/authErrors';

// Regresi untuk bug nyata: siswa melihat "Firebase: Error
// (auth/network-request-failed)." apa adanya di layar login, dan guru
// dengan koneksi bermasalah melihat "Email atau kata sandi salah" yang
// jelas salah diagnosis — keduanya karena .message mentah SDK dipercaya
// langsung tanpa diterjemahkan.

describe('describeAuthError — error SDK Firebase Auth (punya .code)', () => {
  it('menerjemahkan auth/network-request-failed, bukan menampilkan pesan mentah SDK', () => {
    const raw = { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' };
    const result = describeAuthError(raw);
    expect(result).not.toContain('Firebase');
    expect(result).not.toContain('auth/network-request-failed');
    expect(result.toLowerCase()).toContain('internet');
  });

  it('tidak lagi melabeli auth/network-request-failed sebagai "kata sandi salah"', () => {
    const raw = { code: 'auth/network-request-failed', message: 'Firebase: Error (auth/network-request-failed).' };
    const result = describeAuthError(raw, 'Email atau kata sandi salah. Silakan periksa kembali.');
    expect(result).not.toBe('Email atau kata sandi salah. Silakan periksa kembali.');
  });

  it('tetap melabeli auth/wrong-password sebagai kata sandi salah', () => {
    const raw = { code: 'auth/wrong-password', message: 'Firebase: Error (auth/wrong-password).' };
    expect(describeAuthError(raw)).toBe('Email atau kata sandi salah. Silakan periksa kembali.');
  });

  it('code tidak dikenal jatuh ke fallback pemanggil, bukan pesan mentah', () => {
    const raw = { code: 'auth/some-new-code-belum-dipetakan', message: 'Firebase: Error (auth/some-new-code-belum-dipetakan).' };
    expect(describeAuthError(raw, 'fallback kustom')).toBe('fallback kustom');
  });
});

describe('describeAuthError — error aplikasi sendiri (tanpa .code)', () => {
  it('mempertahankan pesan Error biasa yang dilempar kode aplikasi (mis. claimAccessCode)', () => {
    const appError = new Error('Kode akses tidak ditemukan. Periksa kembali kode dari gurumu.');
    expect(describeAuthError(appError)).toBe('Kode akses tidak ditemukan. Periksa kembali kode dari gurumu.');
  });

  it('error tanpa message sama sekali jatuh ke fallback default', () => {
    expect(describeAuthError({})).toMatch(/internet|masuk/i);
  });
});
