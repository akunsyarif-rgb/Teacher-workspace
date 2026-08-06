import * as studentRepository from '../repositories/studentRepository';
import { getWorkspaceById } from '../repositories/workspaceRepository';
import { assertClassLimitNotReached } from './workspaceService';

// Kelas baru (belum ada siswa dengan className ini) kena batas paket;
// menambah siswa ke kelas yang SUDAH ada tidak dihitung sebagai kelas
// baru, jadi tidak diblokir walau workspace sudah di batas.
async function assertCanAddToClass(workspaceId: string, className: string) {
  const [workspace, students] = await Promise.all([
    getWorkspaceById(workspaceId),
    studentRepository.getAllStudents(workspaceId),
  ]);
  if (!workspace) return;
  const existingClasses = new Set(
    students.map((s: any) => s.className?.trim().toUpperCase()).filter(Boolean)
  );
  if (existingClasses.has(className)) return;
  assertClassLimitNotReached(workspace, existingClasses.size);
}

export async function listClassSummaries(workspaceId: string) {
  if (!workspaceId) return [];
  const students = await studentRepository.getAllStudents(workspaceId);

  const counts: Record<string, number> = {};
  students.forEach((s: any) => {
    const cls = s.className?.trim();
    if (!cls) return;
    counts[cls] = (counts[cls] || 0) + 1;
  });

  return Object.keys(counts)
    .sort((a, b) => a.localeCompare(b, 'id'))
    .map((className) => ({ className, count: counts[className] }));
}

export async function getStudentsInClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return studentRepository.getStudentsByClass(workspaceId, className);
}

export async function addSingleStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  if (!data.name || !data.name.trim()) {
    throw new Error('Nama siswa wajib diisi.');
  }
  if (!data.className || !data.className.trim()) {
    throw new Error('Nama kelas wajib diisi.');
  }

  const className = data.className.trim().toUpperCase();
  await assertCanAddToClass(workspaceId, className);

  return studentRepository.createStudent(workspaceId, {
    name: data.name.trim(),
    nis: data.nis?.trim() || '-',
    className,
  });
}

export async function addBulkStudents(
  workspaceId: string,
  className: string,
  namesText: string
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  if (!className || !className.trim()) {
    throw new Error('Nama kelas tujuan wajib diisi.');
  }

  const names = namesText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (names.length === 0) {
    throw new Error('Belum ada nama siswa yang ditempel.');
  }

  const targetClass = className.trim().toUpperCase();
  await assertCanAddToClass(workspaceId, targetClass);

  const students = names.map((name) => ({ name, nis: '-', className: targetClass }));

  const savedCount = await studentRepository.createStudentsBatch(workspaceId, students);
  return { savedCount, targetClass };
}

export async function removeStudent(id: string) {
  return studentRepository.deleteStudent(id);
}
