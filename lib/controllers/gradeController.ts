import * as gradeService from '../services/gradeService';

export async function fetchGradeData(className: string) {
  if (!className) return { columns: [], grades: {} };
  return gradeService.loadGradeData(className);
}

export async function saveGrades(className: string, gradesMap: Record<string, Record<string, string>>) {
  return gradeService.saveAllGrades(className, gradesMap);
}

export async function addColumn(className: string, title: string, type: string) {
  return gradeService.addGradeColumn(className, title, type);
}

export async function removeColumn(id: string) {
  return gradeService.removeGradeColumn(id);
}
