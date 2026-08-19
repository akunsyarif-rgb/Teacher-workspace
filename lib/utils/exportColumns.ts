export type ExportColumn = { key: string; label: string };

export const EXPORT_DATA_TYPE_LABELS: Record<string, string> = {
  students: 'Daftar Siswa',
  journals: 'Jurnal Mengajar',
  attendances: 'Presensi',
  grades: 'Nilai',
  assignments: 'Tugas',
  submissions: 'Pengumpulan Tugas',
  announcements: 'Pengumuman',
  schedules: 'Jadwal Mengajar',
  activityRecap: 'Rekap Aktivitas',
};

export const EXPORT_COLUMNS: Record<string, ExportColumn[]> = {
  students: [
    { key: 'name', label: 'Nama' },
    { key: 'nis', label: 'NIS' },
    { key: 'className', label: 'Kelas' },
  ],
  journals: [
    { key: 'date', label: 'Tanggal' },
    { key: 'className', label: 'Kelas' },
    { key: 'subject', label: 'Mapel' },
    { key: 'topic', label: 'Materi' },
    { key: 'notes', label: 'Catatan' },
  ],
  attendances: [
    { key: 'date', label: 'Tanggal' },
    { key: 'className', label: 'Kelas' },
    { key: 'subject', label: 'Mapel' },
    { key: 'studentName', label: 'Nama Siswa' },
    { key: 'nis', label: 'NIS' },
    { key: 'status', label: 'Status' },
    { key: 'late', label: 'Terlambat' },
    { key: 'keterangan', label: 'Keterangan' },
  ],
  grades: [
    { key: 'className', label: 'Kelas' },
    { key: 'studentName', label: 'Nama Siswa' },
    { key: 'nis', label: 'NIS' },
    { key: 'columnTitle', label: 'Komponen Nilai' },
    { key: 'columnType', label: 'Jenis' },
    { key: 'score', label: 'Nilai' },
  ],
  assignments: [
    { key: 'title', label: 'Judul Tugas' },
    { key: 'className', label: 'Kelas' },
    { key: 'subject', label: 'Mapel' },
    { key: 'dueDate', label: 'Tenggat' },
    { key: 'description', label: 'Instruksi' },
  ],
  submissions: [
    { key: 'date', label: 'Tanggal Kumpul' },
    { key: 'className', label: 'Kelas' },
    { key: 'studentName', label: 'Nama Siswa' },
    { key: 'status', label: 'Status' },
    { key: 'textAnswer', label: 'Jawaban' },
    { key: 'fileName', label: 'Lampiran' },
    { key: 'feedback', label: 'Catatan Guru' },
  ],
  announcements: [
    { key: 'date', label: 'Tanggal' },
    { key: 'className', label: 'Kelas' },
    { key: 'subject', label: 'Mapel' },
    { key: 'title', label: 'Judul' },
    { key: 'body', label: 'Isi' },
  ],
  schedules: [
    { key: 'day', label: 'Hari' },
    { key: 'timeSlot', label: 'Jam' },
    { key: 'className', label: 'Kelas' },
    { key: 'subject', label: 'Mapel' },
  ],
  activityRecap: [
    { key: 'date', label: 'Tanggal' },
    { key: 'dayName', label: 'Hari' },
    { key: 'journalCount', label: 'Jurnal' },
    { key: 'attendanceCount', label: 'Presensi' },
    { key: 'announcementCount', label: 'Pengumuman' },
    { key: 'assignmentCount', label: 'Tugas' },
  ],
};
