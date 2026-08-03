import * as gradeRepository from '../repositories/gradeRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';

export async function loadGradeData(className: string) {
  if (!className) return { columns: [], grades: {} };
  let columns = await gradeColumnRepository.getColumnsByClass(className);
  if (columns.length === 0) {
    columns = await gradeColumnRepository.createDefaultColumns(className);
  }
  const gradeDocs = await gradeRepository.getGradesByClass(className);
  const grades: Record<string, Record<string, string>> = {};
  gradeDocs.forEach((doc: any) => {
    if (!grades[doc.studentId]) grades[doc.studentId] = {};
    grades[doc.studentId][doc.columnId] = doc.score;
  });
  return { columns, grades };
}

export async function saveAllGrades(className: string, gradesMap: Record<string, Record<string, string>>) {
  if (!className) throw new Error('Kelas tidak valid.');
  const entries: { studentId: string; columnId: string; score: string }[] = [];
  Object.keys(gradesMap).forEach((studentId) => {
    Object.keys(gradesMap[studentId]).forEach((columnId) => {
      entries.push({ studentId, columnId, score: gradesMap[studentId][columnId] });
    });
  });
  return gradeRepository.saveGradesBatch(className, entries);
}

export async function addGradeColumn(className: string, title: string, type: string) {
  if (!className) throw new Error('Kelas tidak valid.');
  if (!title || !title.trim()) throw new Error('Judul kolom wajib diisi.');
  return gradeColumnRepository.createColumn({ className, title: title.trim(), type });
}

export async function removeGradeColumn(id: string) {
  return gradeColumnRepository.deleteColumn(id);
}
