import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repository di atas adapter palsu: membuktikan (1) semua query menyaring dokumen soft-deleted,
// (2) "hapus" memanggil soft delete — BUKAN deleteDocument/hapus permanen.

const getDocuments = vi.fn();
const softDeleteDocument = vi.fn(async () => true);
const restoreDocument = vi.fn(async () => true);
const deleteDocument = vi.fn();
const batchWrite = vi.fn();
vi.mock('../lib/adapters/firestoreAdapter', () => ({
  getDocuments: (...a: unknown[]) => getDocuments(...a),
  getAllDocumentsPaged: (...a: unknown[]) => getDocuments(...a),
  getDocumentsPage: vi.fn(),
  getDocumentsWhereIn: vi.fn(),
  getDocument: vi.fn(),
  addDocument: vi.fn(),
  updateDocument: vi.fn(),
  countDocuments: vi.fn(),
  batchWrite: (...a: unknown[]) => batchWrite(...a),
  softDeleteDocument: (...a: unknown[]) => softDeleteDocument(...(a as [])),
  restoreDocument: (...a: unknown[]) => restoreDocument(...(a as [])),
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
}));
vi.mock('../lib/adapters/serverApiAdapter', () => ({ postToServer: vi.fn() }));

import * as studentRepo from '../lib/repositories/studentRepository';
import * as assignmentRepo from '../lib/repositories/assignmentRepository';
import * as columnRepo from '../lib/repositories/gradeColumnRepository';
import * as dashboardRepo from '../lib/repositories/dashboardRepository';
import * as analyticsRepo from '../lib/repositories/analyticsRepository';
import { activeOnly, deletedOnly, isDeleted } from '../lib/utils/softDelete';

const live = (id: string, extra = {}) => ({ id, name: id, ...extra });
const gone = (id: string, extra = {}) => ({ id, name: id, deletedAt: { seconds: 1 }, ...extra });

beforeEach(() => {
  getDocuments.mockReset();
  softDeleteDocument.mockClear();
  restoreDocument.mockClear();
  deleteDocument.mockClear();
});

describe('softDelete utils', () => {
  it('dokumen lama TANPA field deletedAt tetap dianggap aktif (tidak hilang dari query)', () => {
    expect(isDeleted({ id: 'lama' })).toBe(false);
    expect(isDeleted({ deletedAt: null })).toBe(false); // dipulihkan
    expect(isDeleted({ deletedAt: { seconds: 5 } })).toBe(true);
    expect(isDeleted(null)).toBe(false);
    expect(activeOnly([live('a'), gone('b'), { id: 'c', deletedAt: null }]).map((d) => d.id)).toEqual(['a', 'c']);
    expect(deletedOnly([live('a'), gone('b')]).map((d) => d.id)).toEqual(['b']);
  });
});

describe('query menyaring yang di-soft-delete', () => {
  it('siswa: semua + per kelas (terurut nama)', async () => {
    getDocuments.mockResolvedValue([live('Budi'), gone('Citra'), live('Ani')]);
    expect((await studentRepo.getAllStudents('w1')).map((s: any) => s.id)).toEqual(['Budi', 'Ani']);
    expect((await studentRepo.getStudentsByClass('w1', '7A')).map((s: any) => s.id)).toEqual(['Ani', 'Budi']);
  });
  it('siswa terhapus tersedia terpisah untuk pemulihan', async () => {
    getDocuments.mockResolvedValue([live('Budi'), gone('Citra')]);
    expect((await studentRepo.getDeletedStudents('w1')).map((s: any) => s.id)).toEqual(['Citra']);
  });
  it('tugas: guru dan siswa tidak melihat tugas terhapus; daftar terhapus terpisah', async () => {
    getDocuments.mockResolvedValue([live('t1'), gone('t2')]);
    expect((await assignmentRepo.getAssignmentsByClass('w1', '7A')).map((a: any) => a.id)).toEqual(['t1']);
    expect((await assignmentRepo.getDeletedAssignmentsByClass('w1', '7A')).map((a: any) => a.id)).toEqual(['t2']);
  });
  it('kolom nilai: kolom terhapus tidak muncul (nilainya ikut tersembunyi di tabel)', async () => {
    getDocuments.mockResolvedValue([live('k1', { createdAt: { seconds: 2 } }), gone('k2'), live('k0', { createdAt: { seconds: 1 } })]);
    expect((await columnRepo.getColumnsByClass('w1', '7A')).map((c: any) => c.id)).toEqual(['k0', 'k1']);
    expect((await columnRepo.getDeletedColumnsByClass('w1', '7A')).map((c: any) => c.id)).toEqual(['k2']);
  });
  it('beranda & analitik tidak menghitung siswa/tugas terhapus', async () => {
    getDocuments.mockResolvedValue([live('a'), gone('b')]);
    expect((await dashboardRepo.getAllStudentsForSummary('w1')).map((s: any) => s.id)).toEqual(['a']);
    expect((await analyticsRepo.getAssignmentsDueInRange('w1', '2026-01-01', '2026-02-01')).map((s: any) => s.id)).toEqual(['a']);
  });
  it('query tidak memakai where(deletedAt==null) (akan menyembunyikan data lama)', async () => {
    getDocuments.mockResolvedValue([]);
    await studentRepo.getAllStudents('w1');
    await assignmentRepo.getAssignmentsByClass('w1', '7A');
    for (const [, filters] of getDocuments.mock.calls) expect(JSON.stringify(filters)).not.toContain('deletedAt');
  });
});

describe('hapus = soft delete, bukan hapus permanen', () => {
  it('siswa, tugas, kolom nilai', async () => {
    await studentRepo.deleteStudent('s1');
    await assignmentRepo.deleteAssignment('a1');
    await columnRepo.deleteColumn('c1');
    expect(softDeleteDocument.mock.calls).toEqual([['students', 's1'], ['assignments', 'a1'], ['grade_columns', 'c1']]);
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(batchWrite).not.toHaveBeenCalled();
  });
  it('pemulihan memanggil restoreDocument', async () => {
    await studentRepo.restoreStudent('s1');
    await assignmentRepo.restoreAssignment('a1');
    await columnRepo.restoreColumn('c1');
    expect(restoreDocument.mock.calls).toEqual([['students', 's1'], ['assignments', 'a1'], ['grade_columns', 'c1']]);
  });
});
