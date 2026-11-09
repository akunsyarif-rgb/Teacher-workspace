// Konfigurasi dokumen hukum (Kebijakan Privasi & Syarat dan Ketentuan).
//
// DRAF: isinya disusun sebagai titik awal dan BELUM ditinjau ahli hukum. Selama LEGAL_DRAFT = true,
// kedua halaman menampilkan spanduk "draf". Sebelum rilis komersial: isi semua placeholder [DALAM KURUNG
// SIKU], tinjau dengan ahli hukum (mis. kepatuhan UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi),
// naikkan LEGAL_VERSION, lalu set LEGAL_DRAFT = false. tests/legal-pages.test.ts menolak LEGAL_DRAFT = false
// selama masih ada placeholder.
export const LEGAL_DRAFT = true;

/** Versi dokumen yang disetujui pengguna saat daftar (disimpan di profil). Naikkan tiap perubahan isi yang material. */
export const LEGAL_VERSION = '2026-11-09';
export const LEGAL_UPDATED_AT = '9 November 2026';

export const LEGAL_PLACEHOLDERS = {
  entity: '[NAMA BADAN USAHA / PENYELENGGARA]',
  address: '[ALAMAT KANTOR]',
  email: '[EMAIL KONTAK PRIVASI & DUKUNGAN]',
  city: '[KOTA DOMISILI HUKUM]',
  backupRetention: '[LAMA PENYIMPANAN BACKUP, mis. 30 hari]',
  closureRetention: '[LAMA PENYIMPANAN SETELAH AKUN DITUTUP, mis. 30 hari]',
  refund: '[KEBIJAKAN PENGEMBALIAN DANA]',
} as const;

export const LEGAL_PATHS = { privacy: '/privasi', terms: '/syarat' } as const;
