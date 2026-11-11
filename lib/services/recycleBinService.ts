import * as studentRepository from '../repositories/studentRepository';
import * as assignmentRepository from '../repositories/assignmentRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';
import * as trashRepository from '../repositories/trashRepository';
import type { PurgeCountsDto } from '../repositories/trashRepository';
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

// ---------- Hapus permanen (khusus OWNER/ADMIN) ----------

/** Tombol/aksi hapus permanen hanya untuk OWNER/ADMIN (server dan rules menegakkan ulang). */
export const canPurge = (viewer: BinViewer) => isAdminRole(viewer.role);

const MAX_PURGE_ROUNDS = 30;

export type PurgeSummary = { counts: PurgeCountsDto; rounds: number };

const addCounts = (a: PurgeCountsDto, b: PurgeCountsDto): PurgeCountsDto => ({
  students: a.students + b.students, assignments: a.assignments + b.assignments, columns: a.columns + b.columns,
  grades: a.grades + b.grades, submissions: a.submissions + b.submissions, achievements: a.achievements + b.achievements,
  notes: a.notes + b.notes, profiles: a.profiles + b.profiles, loginCodes: a.loginCodes + b.loginCodes, files: a.files + b.files,
});
const zeroCounts = (): PurgeCountsDto => ({ students: 0, assignments: 0, columns: 0, grades: 0, submissions: 0, achievements: 0, notes: 0, profiles: 0, loginCodes: 0, files: 0 });

// Pekerjaan besar diproses server bertahap (done:false = belum tuntas): panggil lagi sampai selesai.
// Aman diulang (idempoten). Batas putaran menjaga agar tidak berputar tanpa akhir.
async function runUntilDone(request: trashRepository.PurgeRequest): Promise<PurgeSummary> {
  let counts = zeroCounts();
  for (let round = 1; round <= MAX_PURGE_ROUNDS; round++) {
    const res = await trashRepository.purgeOnServer(request);
    counts = addCounts(counts, res.counts);
    if (res.done) return { counts, rounds: round };
  }
  throw new Error('Penghapusan belum selesai setelah beberapa kali percobaan. Ulangi untuk melanjutkan — aman diulang.');
}

export async function purgeBinItem(item: Pick<BinItem, 'kind' | 'id' | 'className'>, viewer: BinViewer): Promise<PurgeSummary> {
  // Pemeriksaan di sini hanya untuk pesan yang jelas dan agar tidak memanggil server percuma.
  if (!canPurge(viewer)) throw new Error('Hanya pemilik atau admin workspace yang boleh menghapus permanen.');
  return runUntilDone({ kind: item.kind, id: item.kind === 'class' ? item.className : item.id });
}

export async function emptyBin(viewer: BinViewer): Promise<PurgeSummary> {
  if (!canPurge(viewer)) throw new Error('Hanya pemilik atau admin workspace yang boleh mengosongkan Sampah.');
  return runUntilDone({ all: true });
}

/** Teks ringkas tentang apa yang ikut terhapus, untuk dialog konfirmasi. */
export function describePurgeScope(item: Pick<BinItem, 'kind' | 'count'>): string {
  switch (item.kind) {
    case 'student':
      return 'Siswa ini beserta kode akses, sesi login, nilai, pengumpulan tugas dan lampirannya, prestasi, dan catatan wali kelas dihapus SELAMANYA. Nama siswa pada rekap presensi per pertemuan tetap tersimpan.';
    case 'assignment':
      return 'Tugas ini beserta seluruh pengumpulan siswa dan lampirannya dihapus SELAMANYA. Kolom nilai di gradebook tidak ikut terhapus.';
    case 'column':
      return 'Kolom ini beserta seluruh nilai siswa di dalamnya dihapus SELAMANYA.';
    case 'class':
      return `${item.count ?? 0} siswa di kelas ini beserta seluruh data mereka (nilai, pengumpulan tugas dan lampiran, prestasi, catatan, kode akses) dihapus SELAMANYA. Jurnal, presensi, dan jadwal kelas tidak ikut terhapus.`;
  }
}
