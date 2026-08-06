import * as assignmentRepository from '../repositories/assignmentRepository';
import * as gradeColumnRepository from '../repositories/gradeColumnRepository';

export async function listAssignments(workspaceId: string, className: string) {
  return assignmentRepository.getAssignmentsByClass(workspaceId, className);
}

export async function createAssignment(
  workspaceId: string,
  className: string,
  subject: string,
  data: { title: string; description?: string; dueDate: string }
) {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  if (!className) throw new Error('Kelas tidak valid.');
  if (!data.title || !data.title.trim()) throw new Error('Judul tugas wajib diisi.');
  if (!data.dueDate) throw new Error('Tenggat wajib diisi.');

  // Setiap tugas otomatis punya kolom nilai sendiri di gradebook, supaya
  // saat guru menilai submission, nilainya langsung muncul di rekap nilai
  // tanpa guru harus bikin kolom manual (lihat gradeColumnRepository).
  const gradeColumn: any = await gradeColumnRepository.createColumn({
    workspaceId,
    className,
    title: data.title.trim(),
    type: 'Tugas',
  });

  return assignmentRepository.createAssignment({
    workspaceId,
    className,
    subject: subject.trim(),
    title: data.title.trim(),
    description: data.description?.trim() || '',
    dueDate: data.dueDate,
    gradeColumnId: gradeColumn.id,
  });
}

export async function removeAssignment(id: string) {
  return assignmentRepository.deleteAssignment(id);
}
