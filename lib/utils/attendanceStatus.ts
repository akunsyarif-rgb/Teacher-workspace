// Sumber tunggal untuk kode huruf & warna status presensi — dipakai di
// grid presensi (riwayat + input hari ini) dan ekspor PDF, supaya
// keduanya selalu konsisten.
export const STATUS_LETTER: Record<string, string> = {
  Hadir: '✓',
  Sakit: 'S',
  Izin: 'I',
  Dispensasi: 'D',
  Alpa: 'A',
};

// Dipakai khusus untuk tabel rekap PDF (butuh huruf, bukan simbol ✓).
export const STATUS_LETTER_PLAIN: Record<string, string> = {
  Hadir: 'H',
  Sakit: 'S',
  Izin: 'I',
  Dispensasi: 'D',
  Alpa: 'A',
};

// Hijau=Hadir, Kuning=Sakit, Biru=Izin, Merah=Alpa, Oranye=Terlambat
// (atribut, bukan status). Dispensasi tidak diatur di spesifikasi asli,
// dipertahankan teal supaya tetap beda dari status lain.
// Shade dinaikkan (bukan 500) supaya kontras teks putih di badge huruf
// kecil-tebal ini lolos WCAG AA (>=4.5:1) — shade 500 gagal untuk semua
// warna berikut saat dipasangkan dengan teks putih.
export const STATUS_COLOR: Record<string, string> = {
  Hadir: 'bg-emerald-700',
  Sakit: 'bg-yellow-700',
  Izin: 'bg-blue-600',
  Dispensasi: 'bg-teal-700',
  Alpa: 'bg-red-700',
};

export const STATUS_TEXT_COLOR: Record<string, string> = {
  Hadir: 'text-emerald-600',
  Sakit: 'text-yellow-600',
  Izin: 'text-blue-600',
  Dispensasi: 'text-teal-600',
  Alpa: 'text-red-600',
};

export const LATE_COLOR = 'bg-orange-700';
export const LATE_TEXT_COLOR = 'text-orange-600';
