import * as academicYearRepository from '../repositories/academicYearRepository';
import { shiftWitaDateString } from '../utils/witaDate';

export type AcademicYear = {
  id: string;
  workspaceId: string;
  label: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null; // null = masih aktif/berjalan
  isActive: boolean;
};

export async function listAcademicYears(workspaceId: string): Promise<AcademicYear[]> {
  if (!workspaceId) return [];
  const years = (await academicYearRepository.listByWorkspace(workspaceId)) as AcademicYear[];
  // Terbaru dulu — tahun aktif (endDate null) selalu di atas karena
  // startDate-nya juga selalu yang paling baru (lihat startNewAcademicYear).
  return years.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
}

export async function getActiveAcademicYear(workspaceId: string): Promise<AcademicYear | null> {
  if (!workspaceId) return null;
  return academicYearRepository.getActive(workspaceId) as Promise<AcademicYear | null>;
}

function dayBefore(dateStr: string): string {
  return shiftWitaDateString(dateStr, -1);
}

// Tahun Ajaran murni batas tanggal (lihat COLLECTIONS.ACADEMIC_YEARS) —
// TIDAK menyentuh students/schedules/grades/dst sama sekali. "Tutup Tahun
// Ajaran → Mulai Tahun Ajaran Baru" dari spec digabung jadi satu operasi:
// tahun aktif sebelumnya (kalau ada) ditutup (endDate = sehari sebelum
// tahun baru mulai, isActive=false), lalu tahun baru dibuat isActive=true.
// Guru tetap bebas mengurus roster/nama kelas sendiri lewat fitur yang
// sudah ada (rename kelas, tambah/hapus siswa), kapan pun mereka mau.
export async function startNewAcademicYear(
  workspaceId: string,
  label: string,
  startDate: string
): Promise<AcademicYear> {
  if (!workspaceId) throw new Error('Workspace tidak valid.');
  const trimmedLabel = label.trim();
  if (!trimmedLabel) throw new Error('Label tahun ajaran wajib diisi (contoh: 2026/2027).');
  if (!startDate || isNaN(new Date(startDate).getTime())) {
    throw new Error('Tanggal mulai tidak valid.');
  }

  const current = await academicYearRepository.getActive(workspaceId);
  if (current) {
    if (startDate <= current.startDate) {
      throw new Error(
        `Tanggal mulai harus setelah tahun ajaran "${current.label}" dimulai (${current.startDate}).`
      );
    }
    await academicYearRepository.update(current.id, {
      endDate: dayBefore(startDate),
      isActive: false,
    });
  }

  const payload = { workspaceId, label: trimmedLabel, startDate, endDate: null, isActive: true };
  return academicYearRepository.create(payload) as Promise<AcademicYear>;
}
