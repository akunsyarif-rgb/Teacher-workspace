import * as gradeRepository from '../repositories/gradeRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';

export async function loadGradeData(workspaceId: string, className: string) {
  if (!workspaceId || !className) return { columns: [], grades: {} };
  let columns = await gradeColumnRepository.getColumnsByClass(workspaceId, className);
  if (columns.length === 0) {
    columns = await gradeColumnRepository.createDefaultColumns(workspaceId, className);
  }
  const gradeDocs = await gradeRepository.getGradesByClass(workspaceId, className);
  const grades: Record<string, Record<string, string>> = {};
  gradeDocs.forEach((doc: any) => {
    if (!grades[doc.studentId]) grades[doc.studentId] = {};
    grades[doc.studentId][doc.columnId] = doc.score;
  });
  return { columns, grades };
}

export async function saveAllGrades(
  workspaceId: string,
  className: string,
  gradesMap: Record<string, Record<string, string>>
) {
  if (!workspaceId || !className) throw new Error('Kelas tidak valid.');
  const entries: { studentId: string; columnId: string; score: string }[] = [];
  Object.keys(gradesMap).forEach((studentId) => {
    Object.keys(gradesMap[studentId]).forEach((columnId) => {
      entries.push({ studentId, columnId, score: gradesMap[studentId][columnId] });
    });
  });
  return gradeRepository.saveGradesBatch(workspaceId, className, entries);
}

export async function addGradeColumn(workspaceId: string, className: string, title: string, type: string) {
  if (!workspaceId || !className) throw new Error('Kelas tidak valid.');
  if (!title || !title.trim()) throw new Error('Judul kolom wajib diisi.');
  return gradeColumnRepository.createColumn({ workspaceId, className, title: title.trim(), type });
}

export async function removeGradeColumn(id: string) {
  return gradeColumnRepository.deleteColumn(id);
}
