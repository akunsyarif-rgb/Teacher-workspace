/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseAdapter } from '../adapters/supabaseClient';
import type {
  AttemptResult, AttemptSummary, AttemptView, ExamInput, ExamSummary, IntegrityEventRow, IntegrityReport,
  MonitorView, PackageDetail, PackageInput, PackageSummary, StudentExam,
} from '../types/ulangan';

// Ulangan Harian = Supabase SAJA (tanpa Firestore, tanpa fallback). Repository ini satu-satunya tempat yang memanggil
// RPC ujian lewat adapter; tidak ada query tabel langsung dari klien (tabel ulh_* hanya SELECT untuk guru pengelola,
// siswa tanpa akses) dan tidak ada user_id/student_id/workspace_id/skor/waktu yang dikirim dari klien.
async function rpc(name: string, args: Record<string, any> = {}): Promise<any> {
  const a = getSupabaseAdapter();
  if (!a.rpc) throw new Error('RPC tidak tersedia.');
  return a.rpc(name, args);
}

const result = (r: any): AttemptResult | null =>
  r ? { score: Number(r.score), maxScore: Number(r.max_score), correctCount: Number(r.correct_count) } : null;

const attemptSummary = (a: any): AttemptSummary => ({
  id: a.id, examId: a.exam_id, title: a.title, status: a.status, expiresAt: a.expires_at, serverNow: a.server_now,
  remainingSeconds: Number(a.remaining_seconds), result: result(a.result),
});

// ---------- Guru ----------
export async function savePackage(p: PackageInput): Promise<string> {
  return rpc('ulh_save_package', {
    p_package: {
      id: p.id, title: p.title, subject: p.subject, status: p.status,
      questions: p.questions.map((q) => ({ body: q.body, points: q.points ?? 1, options: q.options, correct_index: q.correctIndex })),
    },
  });
}
export async function deletePackage(id: string) { await rpc('ulh_delete_package', { p_id: id }); }
export async function listPackages(): Promise<PackageSummary[]> {
  return ((await rpc('ulh_list_packages')) ?? []).map((p: any) => ({
    id: p.id, title: p.title, subject: p.subject, status: p.status, questionCount: Number(p.question_count), updatedAt: p.updated_at,
  }));
}
export async function getPackage(id: string): Promise<PackageDetail> {
  const p = await rpc('ulh_get_package', { p_id: id });
  return {
    id: p.id, title: p.title, subject: p.subject, status: p.status,
    questions: p.questions.map((q: any) => ({ id: q.id, body: q.body, points: q.points, options: q.options, correctIndex: q.correct_index })),
  };
}
export async function saveExam(e: ExamInput): Promise<string> {
  return rpc('ulh_save_exam', {
    p_exam: {
      id: e.id, package_id: e.packageId, title: e.title, duration_minutes: e.durationMinutes, opens_at: e.opensAt, closes_at: e.closesAt,
      class_names: e.classNames, shuffle_questions: e.shuffleQuestions, shuffle_options: e.shuffleOptions, show_result: e.showResult,
    },
  });
}
export async function publishExam(id: string) { await rpc('ulh_publish_exam', { p_id: id }); }
export async function closeExam(id: string) { await rpc('ulh_close_exam', { p_id: id }); }
export async function deleteExam(id: string) { await rpc('ulh_delete_exam', { p_id: id }); }
export async function listExams(): Promise<ExamSummary[]> {
  return ((await rpc('ulh_list_exams')) ?? []).map((e: any) => ({
    id: e.id, title: e.title, packageTitle: e.package_title, status: e.status, durationMinutes: e.duration_minutes, opensAt: e.opens_at,
    closesAt: e.closes_at, classNames: e.class_names, showResult: e.show_result, attemptCount: Number(e.attempt_count),
  }));
}
export async function getExamMonitor(examId: string): Promise<MonitorView> {
  const m = await rpc('ulh_exam_monitor', { p_exam_id: examId });
  const s = m.summary ?? {};
  const num = (v: any) => (v === null || v === undefined ? null : Number(v));
  return {
    exam: { id: m.exam.id, title: m.exam.title, status: m.exam.status, opensAt: m.exam.opens_at, closesAt: m.exam.closes_at, durationMinutes: m.exam.duration_minutes, serverNow: m.exam.server_now },
    summary: { assigned: Number(s.assigned ?? 0), started: Number(s.started ?? 0), submitted: Number(s.submitted ?? 0), avgScore: num(s.avg_score), minScore: num(s.min_score), maxScore: num(s.max_score) },
    rows: (m.rows ?? []).map((r: any) => ({
      studentId: r.student_id, name: r.name ?? '', className: r.class_name, attemptId: r.attempt_id, status: r.status,
      answeredCount: Number(r.answered_count), totalQuestions: Number(r.total_questions), score: num(r.score), maxScore: num(r.max_score),
      correctCount: num(r.correct_count), leaveCount: Number(r.leave_count), maxWarningLevel: Number(r.max_warning_level), lastEventAt: r.last_event_at,
    })),
  };
}
export async function getAttemptEvents(attemptId: string): Promise<IntegrityEventRow[]> {
  return ((await rpc('ulh_attempt_events', { p_attempt_id: attemptId })) ?? []).map((e: any) => ({
    id: e.id, eventType: e.event_type, severity: e.severity, warningLevel: e.warning_level, occurredAt: e.occurred_at, durationMs: e.duration_ms,
  }));
}

// ---------- Siswa ----------
export async function listMyExams(): Promise<{ serverNow: string; exams: StudentExam[] }> {
  const r = await rpc('ulh_list_my_exams');
  return {
    serverNow: r.server_now,
    exams: (r.exams ?? []).map((e: any) => ({
      id: e.id, title: e.title, subject: e.subject, status: e.status, durationMinutes: e.duration_minutes, opensAt: e.opens_at, closesAt: e.closes_at,
      attempt: e.attempt ? { id: e.attempt.id, status: e.attempt.status, result: result(e.attempt.result) } : null,
    })),
  };
}
export async function startAttempt(examId: string): Promise<AttemptSummary> { return attemptSummary(await rpc('ulh_start_attempt', { p_exam_id: examId })); }
export async function getAttempt(attemptId: string): Promise<AttemptView> {
  const r = await rpc('ulh_get_attempt', { p_attempt_id: attemptId });
  return { attempt: attemptSummary(r.attempt), questions: r.questions ?? [], answers: r.answers ?? {} };
}
export async function saveAnswer(attemptId: string, questionId: string, optionId: string | null, clientSeq: number): Promise<boolean> {
  return rpc('ulh_save_answer', { p_attempt_id: attemptId, p_question_id: questionId, p_option_id: optionId, p_client_seq: clientSeq });
}
export async function submitAttempt(attemptId: string): Promise<AttemptSummary> { return attemptSummary(await rpc('ulh_submit_attempt', { p_attempt_id: attemptId })); }
export async function reportIntegrityEvent(
  attemptId: string, clientEventId: string, eventType: string, occurredAt: string, durationMs: number | null
): Promise<IntegrityReport> {
  const r = await rpc('ulh_report_integrity_event', {
    p_attempt_id: attemptId, p_client_event_id: clientEventId, p_event_type: eventType, p_occurred_at: occurredAt, p_duration_ms: durationMs, p_metadata: {},
  });
  return { recorded: !!r.recorded, warningLevel: Number(r.warning_level ?? 0), reason: r.reason };
}
