import * as service from '../services/ulanganService';
import * as repo from '../repositories/ulanganRepository';
import type { ExamInput, PackageInput } from '../types/ulangan';

import { syncUlanganIdentity } from '../adapters/ulanganIdentityClient';

// Controller = satu-satunya pintu UI. Tanpa cache sesi: data ujian harus selalu segar dari server.
// Identitas di Supabase berupa proyeksi ber-TTL (guru 30 mnt, siswa 6 jam). Bila RPC menolak karena proyeksi belum ada/kedaluwarsa,
// minta server menyinkronkannya dari Firestore lalu ulangi SEKALI. Penolakan nyata (bukan anggota) tetap muncul sebagai galat.
export const IDENTITY_STALE = /not_a_teacher|not_a_student/;
export const ROSTER_STALE = /class_not_found/;
export async function withIdentity<T>(fn: () => Promise<T>, sync: (roster: boolean) => Promise<unknown> = syncUlanganIdentity): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const identity = IDENTITY_STALE.test(msg);
    if (!identity && !ROSTER_STALE.test(msg)) throw e;
    await sync(!identity || /not_a_teacher/.test(msg));
    return fn();
  }
}
/** Segarkan proyeksi identitas (+ daftar siswa untuk guru). Dipanggil saat halaman guru dibuka. */
export const refreshIdentity = (roster: boolean) => syncUlanganIdentity(roster);
export const fetchPackages = () => withIdentity(() => repo.listPackages());
export const fetchPackage = (id: string) => withIdentity(() => repo.getPackage(id));
export const submitPackage = (p: PackageInput) => withIdentity(() => service.savePackage(p));
export const removePackage = (id: string) => withIdentity(() => repo.deletePackage(id));
export const fetchExams = () => withIdentity(() => repo.listExams());
export const submitExam = (e: ExamInput) => withIdentity(() => service.saveExam(e));
export const publishExam = (id: string) => withIdentity(() => repo.publishExam(id));
export const closeExam = (id: string) => withIdentity(() => repo.closeExam(id));
export const removeExam = (id: string) => withIdentity(() => repo.deleteExam(id));
export const fetchExamMonitor = (examId: string) => withIdentity(() => repo.getExamMonitor(examId));
export const fetchAttemptEvents = (attemptId: string) => withIdentity(() => repo.getAttemptEvents(attemptId));

export const fetchMyExams = () => withIdentity(() => repo.listMyExams());
export const beginAttempt = (examId: string) => withIdentity(() => repo.startAttempt(examId));
export const fetchAttempt = (attemptId: string) => repo.getAttempt(attemptId);
export const answerQuestion = (attemptId: string, questionId: string, optionId: string | null) =>
  repo.saveAnswer(attemptId, questionId, optionId, service.nextClientSeq());
export const finishAttempt = (attemptId: string) => repo.submitAttempt(attemptId);
export const reportLeave = (attemptId: string, eventType: string, startedAtMs: number, durationMs: number) => {
  if (!service.shouldReportLeave(durationMs)) return Promise.resolve(null);
  return repo.reportIntegrityEvent(attemptId, crypto.randomUUID(), eventType, new Date(startedAtMs).toISOString(), durationMs);
};
export const describeError = service.describeUlanganError;
export const warningText = service.integrityWarningText;
