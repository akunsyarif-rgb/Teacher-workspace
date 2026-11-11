// Sinkronisasi bertahap presensi untuk Student Companion.
// Dulu halaman Kehadiran siswa membaca SELURUH riwayat presensi kelas tiap kali dibuka (puluhan-ratusan dokumen,
// padahal siswa hanya butuh barisnya sendiri). Sekarang: baca penuh SEKALI, simpan hanya baris milik siswa itu di
// perangkat, lalu pada pembukaan berikutnya cukup ambil jendela terbaru (OVERLAP_DAYS hari ke belakang) dan gabungkan.
// Batas kebasian: perubahan guru pada pertemuan yang lebih tua dari OVERLAP_DAYS baru terlihat pada sinkron penuh
// berikutnya (FULL_RESYNC_DAYS), atau segera bila siswa keluar-masuk (cache dibersihkan). Fungsi di sini murni.
export const OVERLAP_DAYS = 7;
export const FULL_RESYNC_DAYS = 14;

export type AttendanceDetail = { studentId: string; status: string; late?: boolean };
export type StoredRecord = { id: string; date: string; subject?: string; details: AttendanceDetail[] };
export type SessionDoc = { id: string; date: string; subject?: string; details?: AttendanceDetail[] };
export type SyncState = { items: Record<string, StoredRecord>; syncedThrough: string; fullAt: string };

/** Saring dokumen sesi menjadi hanya baris milik siswa (data lain kelas tidak disimpan di perangkat siswa). */
export function reduceToStudent(records: SessionDoc[], studentId: string): StoredRecord[] {
  const out: StoredRecord[] = [];
  for (const r of records) {
    const mine = (r.details || []).find((d) => d.studentId === studentId);
    if (!mine) continue;
    out.push({ id: r.id, date: r.date, subject: r.subject, details: [mine] });
  }
  return out;
}

/** Gabungkan hasil jendela baru: semua item bertanggal >= windowStart diganti isi jendela (termasuk yang terhapus). */
export function mergeWindow(state: SyncState, windowStart: string, fetched: StoredRecord[], today: string): SyncState {
  const items: Record<string, StoredRecord> = {};
  for (const [id, rec] of Object.entries(state.items)) {
    if ((rec.date || '') < windowStart) items[id] = rec;
  }
  for (const rec of fetched) items[rec.id] = rec;
  return { items, syncedThrough: today, fullAt: state.fullAt };
}

export function buildFullState(fetched: StoredRecord[], today: string): SyncState {
  const items: Record<string, StoredRecord> = {};
  for (const rec of fetched) items[rec.id] = rec;
  return { items, syncedThrough: today, fullAt: today };
}

export type SyncPlan = { kind: 'full' } | { kind: 'window'; windowStart: string };

export function planSync(
  state: SyncState | undefined,
  today: string,
  shift: (date: string, delta: number) => string
): SyncPlan {
  if (!state || !state.fullAt || !state.syncedThrough) return { kind: 'full' };
  if (state.fullAt < shift(today, -FULL_RESYNC_DAYS)) return { kind: 'full' };
  return { kind: 'window', windowStart: shift(state.syncedThrough, -OVERLAP_DAYS) };
}
