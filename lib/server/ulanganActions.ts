import { AuthError, resolveStudent, resolveTeacher, type Doc, type IdentitySources } from './ulanganAuth';

// Aksi Ulangan Harian di sisi server: validasi → (identitas dari Firestore) → RPC Supabase dengan service_role.
// Input klien HANYA berisi data ulangan/jawaban; aktor (workspace, uid, peran, siswa, kelas) selalu dari ulanganAuth.
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type Deps = { rpc: Rpc; src: IdentitySources };

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequest(`invalid_${name}`);
  return v;
};
const obj = (v: unknown): Doc => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequest('invalid_body');
  return v as Doc;
};

export const TEACHER_ACTIONS = ['exam.save', 'exam.get', 'exam.list', 'exam.publish', 'exam.close', 'exam.delete', 'exam.results', 'exam.events'] as const;
export const STUDENT_IDENTITY_ACTIONS = ['student.list', 'attempt.start'] as const;
export const ATTEMPT_ACTIONS = ['attempt.get', 'attempt.answer', 'attempt.submit', 'attempt.event'] as const;
export type Action = (typeof TEACHER_ACTIONS)[number] | (typeof STUDENT_IDENTITY_ACTIONS)[number] | (typeof ATTEMPT_ACTIONS)[number];
export const isAction = (a: unknown): a is Action => [...TEACHER_ACTIONS, ...STUDENT_IDENTITY_ACTIONS, ...ATTEMPT_ACTIONS].includes(a as Action);
export const needsTeacher = (a: Action) => (TEACHER_ACTIONS as readonly string[]).includes(a);
export const needsStudentIdentity = (a: Action) => (STUDENT_IDENTITY_ACTIONS as readonly string[]).includes(a);

type Row = Record<string, unknown>;

// Peserta = siswa di kelas yang ditugaskan (dari Firestore) + siapa pun yang sudah punya attempt (kelasnya mungkin berubah sesudahnya).
async function mergeResults(ws: string, raw: Row, src: IdentitySources) {
  const exam = raw.exam as Row;
  const attempts = (raw.attempts as Row[]) ?? [];
  const roster = await src.listStudents(ws, (exam.class_names as string[]) ?? []);
  const byStudent = new Map(attempts.map((a) => [String(a.student_id), a]));
  const total = Number(exam.question_count ?? 0);
  const rows: Row[] = roster.map((s) => {
    const a = byStudent.get(s.id);
    byStudent.delete(s.id);
    return rowOf(s.id, s.name, a?.class_name ? String(a.class_name) : s.className, a, total);
  });
  for (const [id, a] of byStudent) {
    const d = await src.getDoc('students', id);
    rows.push(rowOf(id, typeof d?.name === 'string' ? d.name : id, String(a.class_name), a, total));
  }
  rows.sort((x, y) => String(x.class_name).localeCompare(String(y.class_name), 'id') || String(x.name).localeCompare(String(y.name), 'id'));
  const scores = rows.map((r) => r.score).filter((v): v is number => typeof v === 'number');
  const summary = {
    assigned: rows.length,
    started: rows.filter((r) => r.status !== 'not_started').length,
    submitted: rows.filter((r) => r.status === 'submitted' || r.status === 'expired').length,
    avg_score: scores.length ? Math.round((scores.reduce((p, c) => p + c, 0) / scores.length) * 100) / 100 : null,
    min_score: scores.length ? Math.min(...scores) : null,
    max_score: scores.length ? Math.max(...scores) : null,
  };
  return { exam, summary, rows };
}
function rowOf(studentId: string, name: string, className: string, a: Row | undefined, total: number): Row {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    student_id: studentId, name, class_name: className, attempt_id: a?.attempt_id ?? null, status: a?.status ?? 'not_started',
    answered_count: Number(a?.answered_count ?? 0), total_questions: total, score: num(a?.score), max_score: num(a?.max_score),
    correct_count: num(a?.correct_count), leave_count: Number(a?.leave_count ?? 0), max_warning_level: Number(a?.max_warning_level ?? 0),
    last_event_at: a?.last_event_at ?? null,
  };
}

export async function runAction(action: Action, uid: string, body: Row, d: Deps): Promise<unknown> {
  if (needsTeacher(action)) {
    const t = await resolveTeacher(uid, d.src);
    const who = { p_ws: t.ws, p_uid: t.uid, p_admin: t.admin };
    switch (action) {
      case 'exam.save': {
        const exam = obj(body.exam);
        const classes = Array.isArray(exam.class_names) ? [...new Set(exam.class_names.filter((c): c is string => typeof c === 'string').map((c) => c.trim()).filter(Boolean))] : [];
        if (classes.length < 1 || classes.length > 20) throw new BadRequest('invalid_classes');
        for (const c of classes) if (!(await d.src.classExists(t.ws, c))) throw new BadRequest('class_not_found'); // kelas harus ada di workspace guru (Firestore)
        // Hanya field yang dikenal diteruskan; apa pun lain dari klien (mis. workspace_id, created_by) dibuang.
        const clean = {
          id: exam.id, title: exam.title, subject: exam.subject, duration_minutes: exam.duration_minutes, opens_at: exam.opens_at,
          closes_at: exam.closes_at, shuffle: exam.shuffle, show_result: exam.show_result, class_names: classes,
          questions: Array.isArray(exam.questions)
            ? exam.questions.slice(0, 101).map((q) => {
                const o = obj(q);
                return { body: o.body, points: o.points, options: o.options, correct_index: o.correct_index };
              })
            : exam.questions,
        };
        return d.rpc('ulh_save_exam', { ...who, p_exam: clean });
      }
      case 'exam.get': return d.rpc('ulh_get_exam', { ...who, p_id: uuid(body.id, 'id') });
      case 'exam.list': return d.rpc('ulh_list_exams', who);
      case 'exam.publish': await d.rpc('ulh_publish_exam', { ...who, p_id: uuid(body.id, 'id') }); return { ok: true };
      case 'exam.close': await d.rpc('ulh_close_exam', { ...who, p_id: uuid(body.id, 'id') }); return { ok: true };
      case 'exam.delete': await d.rpc('ulh_delete_exam', { ...who, p_id: uuid(body.id, 'id') }); return { ok: true };
      case 'exam.events': return d.rpc('ulh_attempt_events', { ...who, p_attempt_id: uuid(body.attemptId, 'attemptId') });
      case 'exam.results': return mergeResults(t.ws, (await d.rpc('ulh_exam_results', { ...who, p_id: uuid(body.id, 'id') })) as Row, d.src);
    }
  }
  if (needsStudentIdentity(action)) {
    const s = await resolveStudent(uid, d.src);
    if (action === 'student.list') return d.rpc('ulh_list_student_exams', { p_ws: s.ws, p_student_id: s.studentId, p_class: s.className });
    return d.rpc('ulh_start_attempt', { p_ws: s.ws, p_uid: s.uid, p_student_id: s.studentId, p_class: s.className, p_exam_id: uuid(body.examId, 'examId') });
  }
  // Tingkat attempt: kepemilikan = uid dari token (baris attempt milik uid itu). Tanpa baca Firestore → murah saat autosave.
  const attemptId = uuid(body.attemptId, 'attemptId');
  switch (action) {
    case 'attempt.get': return d.rpc('ulh_get_attempt', { p_uid: uid, p_attempt_id: attemptId });
    case 'attempt.submit': return d.rpc('ulh_submit_attempt', { p_uid: uid, p_attempt_id: attemptId });
    case 'attempt.answer': {
      const seq = Number(body.seq ?? 0);
      if (!Number.isFinite(seq) || seq < 0 || seq > Number.MAX_SAFE_INTEGER) throw new BadRequest('invalid_seq');
      const option = body.optionId === null ? null : uuid(body.optionId, 'optionId');
      return d.rpc('ulh_save_answer', { p_uid: uid, p_attempt_id: attemptId, p_question_id: uuid(body.questionId, 'questionId'), p_option_id: option, p_client_seq: Math.floor(seq) });
    }
    case 'attempt.event': {
      const type = typeof body.eventType === 'string' ? body.eventType : '';
      const dur = body.durationMs === null || body.durationMs === undefined ? null : Number(body.durationMs);
      if (dur !== null && !Number.isFinite(dur)) throw new BadRequest('invalid_duration');
      const at = typeof body.occurredAt === 'string' && !Number.isNaN(Date.parse(body.occurredAt)) ? body.occurredAt : null;
      return d.rpc('ulh_report_integrity_event', {
        p_uid: uid, p_attempt_id: attemptId, p_client_event_id: uuid(body.clientEventId, 'clientEventId'), p_event_type: type,
        p_occurred_at: at, p_duration_ms: dur === null ? null : Math.round(dur), p_metadata: {},
      });
    }
  }
  throw new BadRequest('unknown_action');
}

export { AuthError };
