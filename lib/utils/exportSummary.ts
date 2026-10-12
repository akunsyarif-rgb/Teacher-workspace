// Ringkasan untuk PDF Download Data (Presensi & Nilai). Murni: tidak mengubah baris sumber, tidak menyentuh CSV/JSON.
type Row = Record<string, unknown>;

export const ATTENDANCE_SUMMARY_COLUMNS = [
  { key: 'className', label: 'Kelas' }, { key: 'sessions', label: 'Sesi tercatat' },
  { key: 'total', label: 'Catatan siswa' }, { key: 'hadir', label: 'Hadir' },
  { key: 'izin', label: 'Izin' }, { key: 'sakit', label: 'Sakit' },
  { key: 'alpha', label: 'Tidak hadir' }, { key: 'dispensasi', label: 'Dispensasi' },
  { key: 'terlambat', label: 'Terlambat' }, { key: 'hadirPercent', label: '% Hadir' },
];

export const GRADE_SUMMARY_COLUMNS = [
  { key: 'className', label: 'Kelas' }, { key: 'studentName', label: 'Nama Siswa' },
  { key: 'nis', label: 'NIS' }, { key: 'components', label: 'Komponen terisi' },
  { key: 'average', label: 'Rata-rata' }, { key: 'highest', label: 'Nilai tertinggi' },
  { key: 'lowest', label: 'Nilai terendah' },
];

const norm = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('id-ID');

/**
 * Nilai angka atau null. Kosong/null/undefined/spasi, boolean, NaN, Infinity dan teks non-angka → null (BUKAN 0).
 * Teks angka diterima dengan titik atau koma desimal ("85", "85.5", "85,5").
 */
export function parseScore(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * KETERBATASAN "Sesi tercatat": baris ekspor presensi (flattenAttendances) tidak membawa ID dokumen sesi maupun scheduleId, jadi sesi diidentifikasi
 * dari (kelas, tanggal, mapel). Dua sesi bermapel sama pada tanggal yang sama di kelas yang sama terhitung SATU (undercount). Memperbaikinya butuh
 * menambah field ke baris ekspor, yang mengubah isi JSON — sengaja tidak dilakukan. Angka lain (catatan siswa, status, % hadir) tidak terpengaruh.
 *
 * Per kelas: sesi unik (tanggal+mapel), jumlah catatan siswa, status, terlambat. % hadir = Hadir ÷ SEMUA catatan siswa (sama dengan summarizeAttendance di aplikasi). */
export function summarizeAttendanceByClass(rows: Row[]) {
  const by = new Map<string, { className: string; sessions: Set<string>; total: number; hadir: number; izin: number; sakit: number; alpha: number; dispensasi: number; terlambat: number }>();
  rows.forEach((row) => {
    const className = String(row.className || 'Tanpa kelas');
    const it = by.get(className) || { className, sessions: new Set<string>(), total: 0, hadir: 0, izin: 0, sakit: 0, alpha: 0, dispensasi: 0, terlambat: 0 };
    it.sessions.add(`${row.date || '-'}|${row.subject || '-'}`);
    it.total += 1;
    const status = norm(row.status);
    if (status === 'hadir') it.hadir += 1;
    else if (status === 'izin') it.izin += 1;
    else if (status === 'sakit') it.sakit += 1;
    else if (status === 'alpa' || status === 'alpha' || status === 'tidak hadir') it.alpha += 1;
    else if (status === 'dispensasi') it.dispensasi += 1;
    if (norm(row.late) === 'ya') it.terlambat += 1;
    by.set(className, it);
  });
  return Array.from(by.values()).sort((a, b) => a.className.localeCompare(b.className, 'id')).map((it) => ({
    className: it.className, sessions: it.sessions.size, total: it.total, hadir: it.hadir, izin: it.izin, sakit: it.sakit,
    alpha: it.alpha, dispensasi: it.dispensasi, terlambat: it.terlambat,
    hadirPercent: it.total ? `${Math.round((it.hadir / it.total) * 100)}%` : '0%',
  }));
}

/** Per siswa: jumlah komponen terisi (angka valid saja), rata-rata, tertinggi, terendah. Siswa tanpa angka valid tidak muncul. */
export function summarizeGradesByStudent(rows: Row[]) {
  const by = new Map<string, { className: string; studentName: string; nis: string; total: number; count: number; highest: number; lowest: number }>();
  rows.forEach((row) => {
    const score = parseScore(row.score);
    if (score === null) return;
    const id = `${row.className || ''}|${row.studentName || ''}|${row.nis || ''}`;
    const it = by.get(id) || { className: String(row.className || '-'), studentName: String(row.studentName || '-'), nis: String(row.nis || '-'), total: 0, count: 0, highest: score, lowest: score };
    it.total += score; it.count += 1;
    it.highest = Math.max(it.highest, score); it.lowest = Math.min(it.lowest, score);
    by.set(id, it);
  });
  return Array.from(by.values())
    .sort((a, b) => a.className.localeCompare(b.className, 'id') || a.studentName.localeCompare(b.studentName, 'id'))
    .map((it) => ({ className: it.className, studentName: it.studentName, nis: it.nis, components: it.count, average: Number((it.total / it.count).toFixed(2)), highest: it.highest, lowest: it.lowest }));
}
