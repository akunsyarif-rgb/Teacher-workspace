/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AttemptResult, AttemptSummary, AttemptView, ExamDetail, ExamInput, ExamSummary, IntegrityEventRow, IntegrityReport,
  MonitorView, StudentExam,
} from '../types/ulangan';

// Ulangan Harian: SEMUA lewat route server /api/ulangan (token Firebase → identitas dari Firestore → Supabase). Klien tidak memanggil
// Supabase langsung dan tidak pernah mengirim workspace/uid/peran/kelas-siswa/skor/waktu: server menurunkannya sendiri.
export class UlanganApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
    this.name = 'UlanganApiError';
  }
}

export type CallDeps = { getToken?: () => Promise<string | null>; fetchImpl?: typeof fetch };
let deps: CallDeps = {};
/** Hanya untuk tes: ganti sumber token/fetch. */
export const __setUlanganDeps = (d: CallDeps) => { deps = d; };

async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const getToken = deps.getToken ?? (async () => (await import('@/src/config/firebase')).auth.currentUser?.getIdToken() ?? null);
  const token = await getToken();
  if (!token) throw new UlanganApiError('not_logged_in', 401);
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)('/api/ulangan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, action }),
    });
  } catch {
    throw new UlanganApiError('network', 0);
  }
  let json: any = null;
  try { json = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) throw new UlanganApiError(String(json?.error ?? `http_${res.status}`), res.status);
  return json?.data ?? null;
}

const result = (r: any): AttemptResult | null =>
  r ? { score: Number(r.score), maxScore: Number(r.max_score), correctCount: Number(r.correct_count) } : null;
const attemptSummary = (a: any): AttemptSummary => ({
  id: a.id, examId: a.exam_id, title: a.title, status: a.status, expiresAt: a.expires_at, serverNow: a.server_now,
  remainingSeconds: Number(a.remaining_seconds), result: result(a.result),
});

// ---------- Guru ----------
export async function saveExam(e: ExamInput): Promise<string> {
  return call('exam.save', {
    exam: {
      id: e.id, title: e.title, subject: e.subject, duration_minutes: e.durationMinutes, opens_at: e.opensAt, closes_at: e.closesAt,
      class_names: e.classNames, shuffle: e.shuffle, show_result: e.showResult,
      questions: e.questions.map((q) => ({ body: q.body, points: q.points ?? 1, options: q.options, correct_index: q.correctIndex })),
    },
  });
}
export async function getExam(id: string): Promise<ExamDetail> {
  const e = await call('exam.get', { id });
  return {
    id: e.id, title: e.title, subject: e.subject, status: e.status, durationMinutes: e.duration_minutes, opensAt: e.opens_at, closesAt: e.closes_at,
    classNames: e.class_names, shuffle: e.shuffle, showResult: e.show_result,
    questions: e.questions.map((q: any) => ({ id: q.id, body: q.body, points: q.points, options: q.options, correctIndex: q.correct_index })),
  };
}
export async function listExams(): Promise<ExamSummary[]> {
  return ((await call('exam.list')) ?? []).map((e: any) => ({
    id: e.id, title: e.title, subject: e.subject, status: e.status, durationMinutes: e.duration_minutes, opensAt: e.opens_at, closesAt: e.closes_at,
    classNames: e.class_names, showResult: e.show_result, questionCount: Number(e.question_count), attemptCount: Number(e.attempt_count),
  }));
}
export async function publishExam(id: string) { await call('exam.publish', { id }); }
export async function closeExam(id: string) { await call('exam.close', { id }); }
export async function deleteExam(id: string) { await call('exam.delete', { id }); }
export async function getExamResults(id: string): Promise<MonitorView> {
  const m = await call('exam.results', { id });
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
  return ((await call('exam.events', { attemptId })) ?? []).map((e: any) => ({
    id: e.id, eventType: e.event_type, severity: e.severity, warningLevel: e.warning_level, occurredAt: e.occurred_at, durationMs: e.duration_ms,
  }));
}

// ---------- Siswa ----------
export async function listMyExams(): Promise<{ serverNow: string; exams: StudentExam[] }> {
  const r = await call('student.list');
  return {
    serverNow: r.server_now,
    exams: (r.exams ?? []).map((e: any) => ({
      id: e.id, title: e.title, subject: e.subject, status: e.status, durationMinutes: e.duration_minutes, opensAt: e.opens_at, closesAt: e.closes_at,
      attempt: e.attempt ? { id: e.attempt.id, status: e.attempt.status, result: result(e.attempt.result) } : null,
    })),
  };
}
export async function startAttempt(examId: string): Promise<AttemptSummary> { return attemptSummary(await call('attempt.start', { examId })); }
export async function getAttempt(attemptId: string): Promise<AttemptView> {
  const r = await call('attempt.get', { attemptId });
  return { attempt: attemptSummary(r.attempt), questions: r.questions ?? [], answers: r.answers ?? {} };
}
export async function saveAnswer(attemptId: string, questionId: string, optionId: string | null, seq: number): Promise<boolean> {
  return call('attempt.answer', { attemptId, questionId, optionId, seq });
}
export async function submitAttempt(attemptId: string): Promise<AttemptSummary> { return attemptSummary(await call('attempt.submit', { attemptId })); }
export async function reportIntegrityEvent(
  attemptId: string, clientEventId: string, eventType: string, occurredAt: string, durationMs: number | null
): Promise<IntegrityReport> {
  const r = await call('attempt.event', { attemptId, clientEventId, eventType, occurredAt, durationMs });
  return { recorded: !!r.recorded, warningLevel: Number(r.warning_level ?? 0), reason: r.reason };
}
