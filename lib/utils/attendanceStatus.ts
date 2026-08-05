// Sumber tunggal untuk kode huruf status presensi — dipakai di strip
// riwayat singkat (StudentAttendanceRow) dan ekspor PDF rekap presensi,
// supaya keduanya selalu konsisten.
export const STATUS_LETTER: Record<string, string> = {
  Hadir: 'H',
  Terlambat: 'T',
  Sakit: 'S',
  Izin: 'I',
  Dispensasi: 'D',
  Alpa: 'A',
};

// Shade 600/700 (bukan 500) supaya kontras teks putih di dalamnya lolos
// WCAG AA (>=4.5:1) — badge huruf status ini berukuran kecil & tebal,
// tidak masuk kategori "teks besar" yang ambang kontrasnya lebih longgar.
export const STATUS_COLOR: Record<string, string> = {
  Hadir: 'bg-blue-600',
  Terlambat: 'bg-orange-700',
  Sakit: 'bg-amber-700',
  Izin: 'bg-purple-600',
  Dispensasi: 'bg-teal-700',
  Alpa: 'bg-red-700',
};
