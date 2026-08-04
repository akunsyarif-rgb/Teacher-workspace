// Sumber tunggal untuk kode huruf status presensi — dipakai di tabel
// riwayat presensi (AttendanceHistoryTable) dan ekspor PDF rekap presensi,
// supaya keduanya selalu konsisten.
export const STATUS_LETTER: Record<string, string> = {
  Hadir: 'H',
  Terlambat: 'T',
  Sakit: 'S',
  Izin: 'I',
  Dispensasi: 'D',
  Alpa: 'A',
};

export const STATUS_COLOR: Record<string, string> = {
  Hadir: 'bg-blue-500',
  Terlambat: 'bg-orange-500',
  Sakit: 'bg-amber-500',
  Izin: 'bg-purple-500',
  Dispensasi: 'bg-teal-500',
  Alpa: 'bg-red-500',
};
