import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateDocument = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../lib/adapters/firestoreAdapter', () => ({
  getDocument: vi.fn(), getDocumentFromCache: vi.fn(), setDocument: vi.fn(),
  updateDocument: (...a: unknown[]) => updateDocument(...a),
  serverTimestamp: () => '__SERVER_TS__',
}));

import PrivacyPage from '../app/privasi/page';
import TermsPage from '../app/syarat/page';
import LegalLinks from '../src/components/legal/LegalLinks';
import { LEGAL_DRAFT, LEGAL_PATHS, LEGAL_PLACEHOLDERS, LEGAL_VERSION } from '../lib/config/legal';
import { recordLegalConsent } from '../lib/services/teacherProfileService';

const privacy = renderToStaticMarkup(createElement(PrivacyPage));
const terms = renderToStaticMarkup(createElement(TermsPage));

describe('Kebijakan Privasi', () => {
  it('memuat bagian wajib: pengendali, data yang diproses, data anak, pihak ketiga, penyimpanan, hak subjek data, kontak', () => {
    for (const must of ['Kebijakan Privasi', 'Siapa yang bertanggung jawab', 'Data yang kami proses', 'Data anak dan siswa', 'Pihak ketiga', 'Penyimpanan dan penghapusan', 'Hak Anda', 'Kontak', 'UU', 'Undang-Undang No. 27 Tahun 2022']) {
      expect(privacy, must).toContain(must === 'UU' ? 'Undang-Undang' : must);
    }
  });
  it('menyebut pemroses yang benar-benar dipakai aplikasi dan data sensitif yang diproses', () => {
    for (const vendor of ['Firebase', 'Supabase', 'Vercel', 'Midtrans']) expect(privacy).toContain(vendor);
    expect(privacy).toMatch(/catatan wali kelas\/konseling/);
    expect(privacy).toMatch(/Sampah/);
  });
});

describe('Syarat dan Ketentuan', () => {
  it('memuat bagian wajib: layanan, akun, tanggung jawab sekolah, larangan, paket dan pembayaran, data, hukum', () => {
    for (const must of ['Syarat dan Ketentuan', 'Layanan', 'Akun dan keamanan', 'Tanggung jawab pemilik workspace', 'Penggunaan yang dilarang', 'Paket dan pembayaran', 'Data Anda', 'Batasan tanggung jawab', 'Hukum yang berlaku', 'Midtrans']) {
      expect(terms, must).toContain(must);
    }
  });
  it('menjelaskan perilaku paket kedaluwarsa yang benar-benar diterapkan aplikasi (batas gratis, data tetap)', () => {
    expect(terms).toMatch(/kembali ke batas paket gratis/);
    expect(terms).toMatch(/tidak dihapus/);
  });
});

describe('status draf dan placeholder', () => {
  it('selama LEGAL_DRAFT=true spanduk draf tampil di kedua halaman', () => {
    expect(LEGAL_DRAFT).toBe(true);
    expect(privacy).toContain('data-testid="legal-draft-banner"');
    expect(terms).toContain('data-testid="legal-draft-banner"');
  });
  it('GUARD RILIS: LEGAL_DRAFT=false tidak boleh dipakai selagi masih ada placeholder [dalam kurung siku]', () => {
    const placeholderRe = /\[[A-Z][^\]]{3,}\]/;
    const stillHasPlaceholders = placeholderRe.test(privacy) || placeholderRe.test(terms);
    if (!LEGAL_DRAFT) expect(stillHasPlaceholders).toBe(false);
    // dan placeholder yang dikonfigurasi benar-benar muncul di dokumen (tidak ada yang terlupa dipakai)
    for (const ph of [LEGAL_PLACEHOLDERS.entity, LEGAL_PLACEHOLDERS.email]) expect(privacy).toContain(ph.replace(/&/g, '&amp;'));
  });
  it('versi dokumen berformat tanggal ISO', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('tautan footer', () => {
  it('LegalLinks memuat kedua tautan dengan path yang benar dan bisa diakses pembaca layar', () => {
    const out = renderToStaticMarkup(createElement(LegalLinks));
    expect(out).toContain(`href="${LEGAL_PATHS.privacy}"`);
    expect(out).toContain(`href="${LEGAL_PATHS.terms}"`);
    expect(out).toContain('aria-label="Informasi hukum"');
  });
  it('halaman hukum saling menautkan', () => {
    expect(privacy).toContain(`href="${LEGAL_PATHS.terms}"`);
    expect(terms).toContain(`href="${LEGAL_PATHS.privacy}"`);
  });
});

describe('pencatatan persetujuan saat daftar', () => {
  beforeEach(() => updateDocument.mockClear());
  it('menulis legalConsentAt (jam SERVER) dan legalConsentVersion ke profil guru', async () => {
    await recordLegalConsent('uid1');
    expect(updateDocument).toHaveBeenCalledWith('teacher_profiles', 'uid1', { legalConsentAt: '__SERVER_TS__', legalConsentVersion: LEGAL_VERSION });
  });
  it('menolak uid kosong', async () => {
    await expect(recordLegalConsent('')).rejects.toThrow();
    expect(updateDocument).not.toHaveBeenCalled();
  });
});
