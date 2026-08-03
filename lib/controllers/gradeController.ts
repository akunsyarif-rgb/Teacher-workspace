import * as gradeService from '../services/gradeService';

export async function fetchGradeData(workspaceId: string, className: string) {
  if (!workspaceId || !className) return { columns: [], grades: {} };
  return gradeService.loadGradeData(workspaceId, className);
}

export async function saveGrades(
  workspaceId: string,
  className: string,
  gradesMap: Record<string, Record<string, string>>
) {
  return gradeService.saveAllGrades(workspaceId, className, gradesMap);
}

export async function addColumn(workspaceId: string, className: string, title: string, type: string) {
  return gradeService.addGradeColumn(workspaceId, className, title, type);
}

export async function removeColumn(id: string) {
  return gradeService.removeGradeColumn(id);
}
