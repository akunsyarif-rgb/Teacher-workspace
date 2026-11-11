// Draf nilai yang belum disimpan, ditahan di perangkat supaya tidak hilang saat halaman dimuat ulang/ditutup.
// Murni (tanpa Firestore/DOM) kecuali fungsi penyimpanan di bawah yang memakai syncStore (localStorage, aman bila
// tidak tersedia). Setiap sel draf mengingat nilai tersimpan saat diketik (`base`): bila nilai tersimpan di server
// sudah berubah sejak itu, sel TIDAK dipulihkan (tidak menimpa diam-diam) dan dihitung sebagai konflik.
import { syncStore } from './persistentCache';

export const GRADE_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
const PREFIX = 'grades-draft:';

export type GradeMatrix = Record<string, Record<string, string>>;
export type DraftCell = { value: string; base: string };
export type GradeDraft = { cells: Record<string, Record<string, DraftCell>> };

export function gradeDraftKey(workspaceId: string, className: string) {
  return `${PREFIX}${workspaceId}:${className}`;
}

/** Hanya sel yang berbeda dari nilai tersimpan. */
export function buildDraft(grades: GradeMatrix, saved: GradeMatrix): GradeDraft | null {
  const cells: GradeDraft['cells'] = {};
  let n = 0;
  for (const [sid, row] of Object.entries(grades)) {
    for (const [cid, value] of Object.entries(row || {})) {
      const base = saved[sid]?.[cid] ?? '';
      if ((value ?? '') === base) continue;
      (cells[sid] ||= {})[cid] = { value: value ?? '', base };
      n += 1;
    }
  }
  return n > 0 ? { cells } : null;
}

export type RestoreResult = {
  grades: GradeMatrix;
  restored: number;
  conflicts: number;
  /** sel bernilai-tersimpan yang dikoreksi → harus dibuka kuncinya supaya tampil sebagai draf */
  unlock: { studentId: string; columnId: string }[];
};

export function restoreDraft(
  draft: GradeDraft,
  saved: GradeMatrix,
  studentIds: Set<string>,
  columnIds: Set<string>
): RestoreResult {
  const grades: GradeMatrix = {};
  for (const [sid, row] of Object.entries(saved)) grades[sid] = { ...row };
  let restored = 0;
  let conflicts = 0;
  const unlock: RestoreResult['unlock'] = [];
  for (const [sid, row] of Object.entries(draft.cells)) {
    for (const [cid, cell] of Object.entries(row)) {
      if (!studentIds.has(sid) || !columnIds.has(cid)) continue; // siswa/kolom sudah tidak ada
      const nowSaved = saved[sid]?.[cid] ?? '';
      if (nowSaved !== cell.base) {
        conflicts += 1;
        continue;
      }
      (grades[sid] ||= {})[cid] = cell.value;
      restored += 1;
      if (cell.base.trim() !== '') unlock.push({ studentId: sid, columnId: cid });
    }
  }
  return { grades, restored, conflicts, unlock };
}

export function saveGradeDraft(workspaceId: string, className: string, draft: GradeDraft | null) {
  const key = gradeDraftKey(workspaceId, className);
  if (draft) syncStore.set(key, draft);
  else syncStore.remove(key);
}

export function loadGradeDraft(workspaceId: string, className: string): GradeDraft | undefined {
  return syncStore.get<GradeDraft>(gradeDraftKey(workspaceId, className), GRADE_DRAFT_TTL_MS);
}

/** Jumlah kelas yang punya draf nilai di perangkat ini (untuk peringatan saat keluar akun). */
export function countGradeDrafts(): number {
  return syncStore.keys(PREFIX).filter((k) => !!syncStore.get(k, GRADE_DRAFT_TTL_MS)).length;
}
