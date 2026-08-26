import { describe, it, expect } from 'vitest';
import {
  buildSubmissionExternalLink,
  isValidSubmissionLink,
  normalizeSubmissionLink,
} from '../lib/utils/submissionLink';

// Alternatif lampiran kalau upload foto ke Firebase Storage gagal — siswa
// tempel link Google Drive/Docs. Validasi ini murni format, tanpa network
// request sama sekali (lihat komentar di lib/utils/submissionLink.ts), jadi
// yang diuji di sini murni soal string masuk-tidaknya, bukan aksesibilitas
// link-nya.

describe('normalizeSubmissionLink / isValidSubmissionLink — format saja, tanpa network', () => {
  it('menerima link Google Drive yang valid', () => {
    expect(isValidSubmissionLink('https://drive.google.com/file/d/abc123/view')).toBe(true);
  });

  it('menerima link Google Docs yang valid', () => {
    expect(isValidSubmissionLink('https://docs.google.com/document/d/abc123/edit')).toBe(true);
  });

  it('menolak URL http (bukan https)', () => {
    expect(isValidSubmissionLink('http://drive.google.com/file/d/abc123/view')).toBe(false);
  });

  it('menolak protokol javascript:', () => {
    expect(isValidSubmissionLink('javascript:alert(1)')).toBe(false);
  });

  it('menolak protokol data:', () => {
    expect(isValidSubmissionLink('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('menolak protokol blob:', () => {
    expect(isValidSubmissionLink('blob:https://example.com/9f1c2b')).toBe(false);
  });

  it('menolak URL yang malformed', () => {
    expect(isValidSubmissionLink('bukan-url-sama-sekali')).toBe(false);
    expect(isValidSubmissionLink('')).toBe(false);
    expect(isValidSubmissionLink('   ')).toBe(false);
    expect(isValidSubmissionLink(null)).toBe(false);
    expect(isValidSubmissionLink(undefined)).toBe(false);
  });

  it('menolak host yang menyerupai Google Drive tapi bukan (subdomain/query palsu)', () => {
    expect(isValidSubmissionLink('https://drive.google.com.evil.com/file')).toBe(false);
    expect(isValidSubmissionLink('https://evil.com/?u=https://drive.google.com')).toBe(false);
    expect(isValidSubmissionLink('https://drive.google.com@evil.com/')).toBe(false);
  });

  it('menolak host Google lain yang tidak termasuk daftar', () => {
    expect(isValidSubmissionLink('https://mail.google.com/mail/u/0')).toBe(false);
    expect(isValidSubmissionLink('https://google.com/')).toBe(false);
  });

  // Menyamakan client dengan Firestore rules: isValidExternalLink() di
  // firestore.rules mem-regex SELURUH string URL, sedangkan pengecekan
  // hostname di atas sendirian tidak menangkap port non-default atau
  // userinfo yang menyelip di antara "https://" dan hostname — sebelumnya
  // client bilang valid untuk keduanya padahal rules menolak saat
  // benar-benar ditulis ke Firestore.
  it('menolak URL Google Drive dengan port non-default (client harus sama ketat dengan rules)', () => {
    expect(isValidSubmissionLink('https://drive.google.com:8443/file/d/x')).toBe(false);
  });

  it('menerima URL dengan port default https (:443) — dihapus otomatis oleh URL(), bukan port asing', () => {
    // new URL() sendiri sudah menghilangkan port default saat parsing
    // (dikonfirmasi: `new URL('https://x:443/y').port === ''`), jadi
    // string yang benar-benar ditulis ke Firestore tidak pernah memuat
    // ":443" sama sekali — rules pun tidak pernah melihat port ini.
    expect(isValidSubmissionLink('https://docs.google.com:443/document/d/x')).toBe(true);
    expect(normalizeSubmissionLink('https://docs.google.com:443/document/d/x')).toBe(
      'https://docs.google.com/document/d/x'
    );
  });

  it('menolak URL dengan userinfo (user@ atau user:pass@) sebelum hostname', () => {
    expect(isValidSubmissionLink('https://evil.com@drive.google.com/x')).toBe(false);
    expect(isValidSubmissionLink('https://user:pass@drive.google.com/x')).toBe(false);
  });

  it('URL normal Google Drive/Docs tetap valid dan tidak berubah oleh normalisasi baru', () => {
    expect(isValidSubmissionLink('https://drive.google.com/file/d/abc/view')).toBe(true);
    expect(isValidSubmissionLink('https://docs.google.com/document/d/abc/edit')).toBe(true);
    expect(normalizeSubmissionLink('https://drive.google.com/file/d/abc/view')).toBe(
      'https://drive.google.com/file/d/abc/view'
    );
    expect(normalizeSubmissionLink('https://docs.google.com/document/d/abc/edit')).toBe(
      'https://docs.google.com/document/d/abc/edit'
    );
  });

  it('normalizeSubmissionLink mengembalikan URL yang sudah diparse ulang', () => {
    expect(normalizeSubmissionLink('https://drive.google.com/file/d/abc/view')).toBe(
      'https://drive.google.com/file/d/abc/view'
    );
  });

  it('normalizeSubmissionLink null untuk link tidak valid', () => {
    expect(normalizeSubmissionLink('javascript:alert(1)')).toBeNull();
  });
});

describe('buildSubmissionExternalLink — metadata siap simpan', () => {
  it('menghasilkan provider & label default yang benar untuk link valid', () => {
    expect(buildSubmissionExternalLink('https://drive.google.com/file/d/abc/view')).toEqual({
      provider: 'google-drive',
      url: 'https://drive.google.com/file/d/abc/view',
      label: 'Lampiran Google Drive',
    });
  });

  it('null untuk link tidak valid — pemanggil wajib menangani ini', () => {
    expect(buildSubmissionExternalLink('javascript:alert(1)')).toBeNull();
    expect(buildSubmissionExternalLink('')).toBeNull();
  });
});
