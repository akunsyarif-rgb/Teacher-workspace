import * as studentRepository from '../repositories/studentRepository';
import * as assignmentRepository from '../repositories/assignmentRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';
import type { Doc } from '../adapters/firestoreAdapter';
import type { StudentData, AssignmentData, GradeColumnData } from '../types/models';

// Recycle Bin (TD-001): daftar item yang di-soft-delete + pemulihan. Fungsi murni
// (buildRecycleBin, canRestoreItem) dipisah dari pengambilan data supaya mudah diuji.

export type BinKind = 'class' | 'student' | 'assignment' | 'column';

export type BinItem = {
  /** Kunci unik tampilan. */
  key: string;
  kind: BinKind;
  /** id dokumen (untuk kelas: nama kelas). */
  id: string;
  title: string;
  /** Konteks singkat, mis. "Kelas 7A · 3 siswa". */
  detail: string;
  className: string;
  /** epoch ms; null bila tidak diketahui. */
  deletedAt: number | null;
  deletedBy: string | null;
  createdBy: string | null;
  /** Jumlah siswa (khusus kelas). */
  count?: number;
};

export type BinViewer = { uid: string; role: string | null };

type Deletable = {
  id: string;
  className?: string;
  createdBy?: string;
  deletedAt?: unknown;
  deletedBy?: string | null;
  deletedBatchId?: string | null;
};

function toMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return typeof value === 'number' ? value : null;
  const t = value as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return null;
}

export const isAdminRole = (role: string | null) => role === 'OWNER' || role === 'ADMIN';

/**
 * Sama dengan aturan di server/rules: OWNER/ADMIN boleh memulihkan apa pun; guru biasa hanya
 * item yang IA SENDIRI buat. Item lama tanpa createdBy hanya untuk OWNER/ADMIN. Kelas utuh
 * (dihapus massal oleh OWNER/ADMIN) hanya bisa dipulihkan OWNER/ADMIN.
 */
export function canRestoreItem(item: Pick<BinItem, 'kind' | 'createdBy'>, viewer: BinViewer): boolean {
  if (isAdminRole(viewer.role)) return true;
  if (item.kind === 'class') return false;
  return !!item.createdBy && item.createdBy === viewer.uid;
}

const byNewest = (a: BinItem, b: BinItem) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0);

export type RecycleBinData = {
  classes: BinItem[];
  students: BinItem[];
  assignments: BinItem[];
  columns: BinItem[];
  total: number;
};

export function buildRecycleBin(
  raw: {
    students: Doc<StudentData>[];
    assignments: Doc<AssignmentData>[];
    columns: Doc<GradeColumnData>[];
  },
  viewer: BinViewer
): RecycleBinData {
  const base = (d: Deletable) => ({
    className: d.className ?? '',
    deletedAt: toMillis(d.deletedAt),
    deletedBy: d.deletedBy ?? null,
    createdBy: d.createdBy ?? null,
  });

  // Kelas terhapus = siswa yang terhapus lewat "hapus kelas" (punya deletedBatchId), dikelompokkan per kelas.
  const classGroups = new Map<string, { count: number; deletedAt: number | null; deletedBy: string | null }>();
  const individualStudents: Doc<StudentData>[] = [];
  for (const s of raw.students) {
    if (s.deletedBatchId) {
      const g = classGroups.get(s.className) ?? { count: 0, deletedAt: null, deletedBy: null };
      g.count += 1;
      const at = toMillis(s.deletedAt);
      if (at !== null && (g.deletedAt === null || at > g.deletedAt)) g.deletedAt = at;
      g.deletedBy = s.deletedBy ?? g.deletedBy;
      classGroups.set(s.className, g);
    } else {
      individualStudents.push(s);
    }
  }

  const classes: BinItem[] = [...classGroups.entries()].map(([className, g]) => ({
    key: `class:${className}`,
    kind: 'class',
    id: className,
    title: `Kelas ${className}`,
    detail: `${g.count} siswa`,
    className,
    deletedAt: g.deletedAt,
    deletedBy: g.deletedBy,
    createdBy: null,
    count: g.count,
  }));

  const students: BinItem[] = individualStudents.map((s) => ({
    key: `student:${s.id}`,
    kind: 'student',
    id: s.id,
    title: s.name,
    detail: `Siswa · Kelas ${s.className}`,
    ...base(s),
  }));

  const assignments: BinItem[] = raw.assignments.map((a) => ({
    key: `assignment:${a.id}`,
    kind: 'assignment',
    id: a.id,
    title: a.title,
    detail: `Tugas · Kelas ${a.className}`,
    ...base(a),
  }));

  const columns: BinItem[] = raw.columns.map((c) => ({
    key: `column:${c.id}`,
    kind: 'column',
    id: c.id,
    title: c.title,
    detail: `Kolom nilai · Kelas ${c.className}`,
    ...base(c),
  }));

  // Guru biasa hanya melihat yang bisa ia pulihkan (tidak menampilkan sampah guru lain).
  const visible = (items: BinItem[]) => items.filter((i) => canRestoreItem(i, viewer)).sort(byNewest);
  const result = {
    classes: visible(classes),
    students: visible(students),
    assignments: visible(assignments),
    columns: visible(columns),
  };
  return { ...result, total: result.classes.length + result.students.length + result.assignments.length + result.columns.length };
}

export async function loadRecycleBin(workspaceId: string, viewer: BinViewer): Promise<RecycleBinData> {
  if (!workspaceId) return { classes: [], students: [], assignments: [], columns: [], total: 0 };
  const [students, assignments, columns] = await Promise.all([
    studentRepository.getDeletedStudents(workspaceId),
    assignmentRepository.getDeletedAssignments(workspaceId),
    gradeColumnRepository.getDeletedColumns(workspaceId),
  ]);
  return buildRecycleBin({ students, assignments, columns }, viewer);
}

export async function restoreBinItem(item: Pick<BinItem, 'kind' | 'id' | 'className'>, viewer: BinViewer) {
  // Pemeriksaan di sini hanya untuk pesan yang jelas; yang menegakkan tetap server dan firestore.rules.
  if (item.kind === 'class' && !isAdminRole(viewer.role)) {
    throw new Error('Hanya pemilik atau admin workspace yang bisa memulihkan kelas.');
  }
  switch (item.kind) {
    case 'class':
      return studentRepository.restoreClassOnServer(item.className);
    case 'student':
      return studentRepository.restoreStudent(item.id);
    case 'assignment':
      return assignmentRepository.restoreAssignment(item.id);
    case 'column':
      return gradeColumnRepository.restoreColumn(item.id);
  }
}
