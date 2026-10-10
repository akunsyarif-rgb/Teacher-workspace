import * as service from '../services/ulanganService';
import * as repo from '../repositories/ulanganRepository';
import type { ExamInput, PackageInput } from '../types/ulangan';

// Controller = satu-satunya pintu UI. Tanpa cache sesi: data ujian harus selalu segar dari server.
export const fetchPackages = () => repo.listPackages();
export const fetchPackage = (id: string) => repo.getPackage(id);
export const submitPackage = (p: PackageInput) => service.savePackage(p);
export const removePackage = (id: string) => repo.deletePackage(id);
export const fetchExams = () => repo.listExams();
export const submitExam = (e: ExamInput) => service.saveExam(e);
export const publishExam = (id: string) => repo.publishExam(id);
export const closeExam = (id: string) => repo.closeExam(id);
export const removeExam = (id: string) => repo.deleteExam(id);
export const fetchExamMonitor = (examId: string) => repo.getExamMonitor(examId);
export const fetchAttemptEvents = (attemptId: string) => repo.getAttemptEvents(attemptId);

export const fetchMyExams = () => repo.listMyExams();
export const beginAttempt = (examId: string) => repo.startAttempt(examId);
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
