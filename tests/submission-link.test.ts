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
