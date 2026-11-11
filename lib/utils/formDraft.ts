// Draf formulir teks umum (jurnal, pengumuman, tugas, catatan siswa, jawaban tugas siswa) yang ditahan di
// perangkat supaya tidak hilang saat halaman dimuat ulang/ditutup. Draf nilai punya modul sendiri (gradeDraft.ts)
// karena perlu deteksi konflik per sel. Penyimpanan lewat syncStore (localStorage; no-op bila tidak tersedia).
import { syncStore } from './persistentCache';
import { countGradeDrafts } from './gradeDraft';

export const FORM_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
const PREFIX = 'form-draft:';

export function formDraftKey(...parts: (string | number | null | undefined)[]) {
  return PREFIX + parts.map((p) => String(p ?? '-')).join(':');
}

export function saveFormDraft<T>(key: string, value: T) {
  syncStore.set(key, value);
}
export function loadFormDraft<T>(key: string): T | undefined {
  return syncStore.get<T>(key, FORM_DRAFT_TTL_MS);
}
export function removeFormDraft(key: string) {
  syncStore.remove(key);
}

export function countFormDrafts(): number {
  return syncStore.keys(PREFIX).filter((k) => syncStore.get(k, FORM_DRAFT_TTL_MS) !== undefined).length;
}

/** Semua draf yang belum disimpan di perangkat (nilai + formulir) — untuk peringatan sebelum keluar akun. */
export function countUnsavedDrafts(): number {
  return countGradeDrafts() + countFormDrafts();
}
