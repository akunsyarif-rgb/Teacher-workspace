import * as studentService from '../services/studentService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function classSummariesCacheKey(workspaceId: string) {
  return `classSummaries:${workspaceId}`;
}

export async function fetchClassSummaries(workspaceId: string) {
  if (!workspaceId) return [];
  return withCache(classSummariesCacheKey(workspaceId), () => studentService.listClassSummaries(workspaceId));
}

export function studentsInClassCacheKey(workspaceId: string, className: string) {
  return `studentsInClass:${workspaceId}:${className}`;
}

export async function fetchStudentsInClass(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(studentsInClassCacheKey(workspaceId, className), () =>
    studentService.getStudentsInClass(workspaceId, className)
  );
}

export async function submitSingleStudent(
  workspaceId: string,
  data: { name: string; nis: string; className: string }
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const result = await studentService.addSingleStudent(workspaceId, data);
  clearAllCached();
  return result;
}

export async function submitBulkStudents(
  workspaceId: string,
  className: string,
  namesText: string
) {
  if (!workspaceId) throw new Error('workspaceId diperlukan');
  const result = await studentService.addBulkStudents(workspaceId, className, namesText);
  clearAllCached();
  return result;
}

export async function deleteStudent(id: string) {
  const result = await studentService.removeStudent(id);
  clearAllCached();
  return result;
}

export async function deleteClass(workspaceId: string, className: string) {
  const result = await studentService.removeClass(workspaceId, className);
  clearAllCached();
  return result;
}

export async function generateMissingAccessCodes(workspaceId: string, className: string) {
  const result = await studentService.generateMissingAccessCodes(workspaceId, className);
  clearAllCached();
  return result;
}

// Lewat route server (Admin SDK), bukan Firestore langsung — lihat
// app/api/classes/rename/route.ts untuk alasannya (student_profiles
// immutable dari client).
export async function submitRenameClass(idToken: string, oldName: string, newName: string) {
  const res = await fetch('/api/classes/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ oldName, newName }),
  });

  // res.json() TIDAK boleh dipanggil tanpa syarat. Kalau platform yang
  // membalas (function timeout 504, crash 502, halaman error proxy), body-nya
  // HTML/teks — JSON.parse melempar SyntaxError mentah yang langsung
  // tertampil ke guru. Di WebKit/Safari kalimatnya "The string did not match
  // the expected pattern.", yang tidak memberi tahu apa pun tentang masalah
  // sebenarnya dan terbaca seolah nama kelasnya yang salah.
  const data = await readJsonSafely(res);

  if (!res.ok) {
    throw new Error(data?.error || describeHttpFailure(res.status));
  }
  // Respons 2xx yang tetap bukan JSON berarti bukan route kita yang menjawab.
  if (data === undefined) {
    throw new Error(
      'Server membalas dalam format yang tidak dikenali. Muat ulang halaman dan periksa nama kelas sebelum mencoba lagi.'
    );
  }

  clearAllCached();
  return data;
}

type RenameResponseBody = { error?: string; renamedCount?: number; className?: string };

// undefined = body bukan JSON yang sah (bukan "JSON bernilai null").
async function readJsonSafely(res: Response): Promise<RenameResponseBody | undefined> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return undefined;
  try {
    return await res.json();
  } catch {
    // Content-Type menjanjikan JSON tapi body-nya terpotong/rusak.
    return undefined;
  }
}

// Rename menyentuh banyak koleksi sekaligus dan commit-nya dipecah per batch
// (lihat lib/server/classAdminService.ts), jadi kegagalan di tengah jalan bisa
// menyisakan sebagian dokumen sudah memakai nama baru. Pesannya sengaja
// menyuruh guru MEMERIKSA dulu, bukan langsung mengulang — mengulang di atas
// rename yang separuh jadi justru memperparah.
function describeHttpFailure(status: number): string {
  if (status === 504 || status === 408) {
    return 'Server tidak selesai memproses tepat waktu (504). Penggantian nama mungkin baru sebagian — periksa nama kelas dulu, jangan langsung mencoba lagi.';
  }
  if (status === 502 || status === 503) {
    return `Server sedang tidak bisa menyelesaikan permintaan (${status}). Periksa nama kelas dulu sebelum mencoba lagi.`;
  }
  if (status === 401 || status === 403) {
    return 'Sesi login sudah tidak berlaku. Muat ulang halaman lalu coba lagi.';
  }
  return `Gagal mengganti nama kelas (HTTP ${status}).`;
}
