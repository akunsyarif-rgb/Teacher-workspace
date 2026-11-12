// Pembatasan Beranda/Analitik per guru. Dokumen lama (sebelum createdBy dicap otomatis, 2026-11-08) TIDAK punya
// createdBy, jadi "milik saya" = tanpa createdBy ATAU createdBy == uid: data lama tetap tampil (tidak ada yang
// hilang), data baru terpisah per guru. Kelas "milik saya" diturunkan dari jadwal milik saya (+ kelas wali).
export type TeacherScope = { uid: string; role?: string | null; homeroomClassName?: string | null };

export function isMine(doc: { createdBy?: string | null }, uid: string): boolean {
  return !doc.createdBy || doc.createdBy === uid;
}

/** Nama kelas unik (sudah di-trim) dari jadwal milik saya + kelas wali. */
export function myClassNames(schedules: { className?: string; createdBy?: string | null }[], scope: TeacherScope): string[] {
  const set = new Set<string>();
  for (const s of schedules) {
    if (!isMine(s, scope.uid)) continue;
    const c = s.className?.trim();
    if (c) set.add(c);
  }
  const home = scope.homeroomClassName?.trim();
  if (home) set.add(home);
  return Array.from(set).sort();
}

/** Varian penulisan untuk query `in` (nilai tersimpan bisa memuat spasi di ujung). */
export function classNameVariants(schedules: { className?: string }[], classes: string[]): string[] {
  const set = new Set<string>(classes);
  for (const s of schedules) {
    const raw = s.className;
    if (raw && classes.includes(raw.trim())) set.add(raw);
  }
  return Array.from(set);
}

/** Sidik jari ringkas himpunan kelas — bagian kunci cache supaya cache tidak dipakai lintas himpunan kelas. */
export function classSignature(classes: string[]): string {
  let h = 5381;
  const s = [...classes].sort().join('|');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
