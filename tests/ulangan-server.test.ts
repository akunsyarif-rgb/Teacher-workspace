import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, resolveStudent, resolveTeacher, type Doc, type IdentitySources } from '../lib/server/ulanganAuth';
import { BadRequest, runAction, type Deps } from '../lib/server/ulanganActions';

// Lapisan server Ulangan Harian dengan Firestore & Supabase PALSU (tanpa jaringan): identitas hanya dari Firestore, aktor tak bisa
// dipalsukan lewat body, galat dipetakan, rekap menggabungkan roster Firestore dengan attempt.
function world(docs: Record<string, Doc> = {}) {
  const all: Record<string, Doc> = {
    'workspaces/wsA': { ownerUid: 'owner' }, 'workspaces/wsB': { ownerUid: 'owner2' },
    'teacher_profiles/owner': { workspaceId: 'wsA', role: 'OWNER' },
    'teacher_profiles/admin': { workspaceId: 'wsA', role: 'ADMIN' },
    'teacher_profiles/guru': { workspaceId: 'wsA', role: 'TEACHER', isActive: true },
    'student_profiles/anon1': { studentId: 's1', workspaceId: 'wsA', className: '7A' },
    'students/s1': { workspaceId: 'wsA', className: '7A', name: 'Budi' },
    'students/s2': { workspaceId: 'wsA', className: '7A', name: 'Sari' },
    'students/s3': { workspaceId: 'wsA', className: '7B', name: 'Dewi' },
    'students/b1': { workspaceId: 'wsB', className: '8A', name: 'Bima' },
    ...docs,
  };
  const src: IdentitySources = {
    getDoc: async (c, id) => (all[`${c}/${id}`] ? { ...all[`${c}/${id}`] } : null),
    classExists: async (ws, cn) => Object.entries(all).some(([k, v]) => k.startsWith('students/') && v.workspaceId === ws && v.className === cn),
    listStudents: async (ws, cns) => Object.entries(all).filter(([k, v]) => k.startsWith('students/') && v.workspaceId === ws && cns.includes(String(v.className)))
      .map(([k, v]) => ({ id: k.split('/')[1], className: String(v.className), name: String(v.name) })),
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpcImpl = { fn: async (name: string, args: Record<string, unknown>): Promise<unknown> => { void name; void args; return null; } };
  const deps: Deps = { src, rpc: async (name, args) => { calls.push({ name, args }); return rpcImpl.fn(name, args); } };
  return { all, src, deps, calls, rpcImpl };
}
const UUID = '11111111-1111-4111-8111-111111111111';

describe('identitas dari Firestore', () => {
  it('guru: peran valid & aktif; admin = OWNER/ADMIN; peran/workspace tak valid, nonaktif, workspace hilang, OWNER palsu → ditolak', async () => {
    const w = world();
    expect(await resolveTeacher('guru', w.src)).toEqual({ uid: 'guru', ws: 'wsA', admin: false });
    expect(await resolveTeacher('admin', w.src)).toMatchObject({ admin: true });
    expect(await resolveTeacher('owner', w.src)).toMatchObject({ admin: true });
    const bad: Record<string, Doc>[] = [
      { 'teacher_profiles/guru': { workspaceId: 'wsA', role: 'SUPERADMIN' } }, { 'teacher_profiles/guru': { workspaceId: '', role: 'TEACHER' } },
      { 'teacher_profiles/guru': { workspaceId: 'wsA', role: 'TEACHER', isActive: false } }, { 'teacher_profiles/guru': { workspaceId: 'wsZ', role: 'TEACHER' } },
      { 'teacher_profiles/guru': { workspaceId: 'wsA', role: 'OWNER' } }, // mengaku OWNER wsA padahal ownerUid = 'owner'
    ];
    for (const b of bad) await expect(resolveTeacher('guru', world(b).src)).rejects.toMatchObject({ code: 'not_a_teacher', status: 403 });
    await expect(resolveTeacher('siswaAnon', w.src)).rejects.toBeInstanceOf(AuthError);
    await expect(resolveTeacher('anon1', w.src)).rejects.toMatchObject({ code: 'not_a_teacher' }); // siswa bukan guru
  });
  it('siswa: kelas dari dokumen students (profil basi tak jadi masalah); workspace beda / siswa dihapus / tanpa kelas → ditolak', async () => {
    expect(await resolveStudent('anon1', world().src)).toEqual({ uid: 'anon1', ws: 'wsA', studentId: 's1', className: '7A' });
    expect(await resolveStudent('anon1', world({ 'students/s1': { workspaceId: 'wsA', className: ' 7B ' } }).src)).toMatchObject({ className: '7B' }); // pindah kelas
    for (const d of [{ 'students/s1': { workspaceId: 'wsB', className: '7A' } }, { 'students/s1': { workspaceId: 'wsA', className: '' } }, { 'students/s1': { workspaceId: 'wsA' } }]) {
      await expect(resolveStudent('anon1', world(d as Record<string, Doc>).src)).rejects.toMatchObject({ code: 'not_a_student' });
    }
    const gone = world(); delete gone.all['students/s1'];
    await expect(resolveStudent('anon1', gone.src)).rejects.toMatchObject({ code: 'not_a_student' });
    await expect(resolveStudent('guru', world().src)).rejects.toMatchObject({ code: 'not_a_student' }); // guru bukan siswa
  });
});

describe('aksi server', () => {
  const exam = (extra: Record<string, unknown> = {}) => ({
    title: 'UH', subject: 'IPA', duration_minutes: 30, opens_at: 'a', closes_at: 'b', shuffle: true, show_result: false, class_names: ['7A'],
    questions: [{ body: 'Q', options: ['a', 'b'], correct_index: 0 }], ...extra,
  });
  let w: ReturnType<typeof world>;
  beforeEach(() => { w = world(); });

  it('aktor guru dari Firestore, bukan dari body; field asing dibuang; kelas harus ada di workspace guru', async () => {
    await runAction('exam.save', 'guru', { exam: exam({ workspace_id: 'wsB', created_by: 'owner2', id: UUID, evil: 1, questions: [{ body: 'Q', options: ['a', 'b'], correct_index: 0, workspace_id: 'wsB', extra: 'x' }] }), ws: 'wsB', p_ws: 'wsB', uid: 'owner2', admin: true }, w.deps);
    const c = w.calls[0];
    expect(c.name).toBe('ulh_save_exam');
    expect(c.args).toMatchObject({ p_ws: 'wsA', p_uid: 'guru', p_admin: false });
    const payload = JSON.stringify(c.args.p_exam);
    expect(payload).not.toMatch(/wsB|owner2|evil|extra|created_by|workspace_id/);
    expect((c.args.p_exam as Doc).id).toBe(UUID);
    await runAction('exam.list', 'admin', {}, w.deps);
    expect(w.calls[1].args).toEqual({ p_ws: 'wsA', p_uid: 'admin', p_admin: true });
    await expect(runAction('exam.save', 'guru', { exam: exam({ class_names: ['9Z'] }) }, w.deps)).rejects.toMatchObject({ message: 'class_not_found' });
    await expect(runAction('exam.save', 'guru', { exam: exam({ class_names: ['8A'] }) }, w.deps)).rejects.toBeInstanceOf(BadRequest); // 8A ada, tapi di workspace lain
    await expect(runAction('exam.save', 'guru', { exam: exam({ class_names: [] }) }, w.deps)).rejects.toMatchObject({ message: 'invalid_classes' });
    expect(w.calls).toHaveLength(2); // penolakan terjadi SEBELUM memanggil Supabase
  });

  it('tindakan guru oleh siswa / bukan anggota ditolak 403 tanpa menyentuh Supabase; tindakan siswa oleh guru ditolak', async () => {
    for (const a of ['exam.list', 'exam.save', 'exam.publish', 'exam.results'] as const)
      await expect(runAction(a, 'anon1', { exam: exam(), id: UUID }, w.deps)).rejects.toMatchObject({ code: 'not_a_teacher' });
    await expect(runAction('exam.list', 'orangAsing', {}, w.deps)).rejects.toBeInstanceOf(AuthError);
    await expect(runAction('student.list', 'guru', {}, w.deps)).rejects.toMatchObject({ code: 'not_a_student' });
    await expect(runAction('attempt.start', 'guru', { examId: UUID }, w.deps)).rejects.toMatchObject({ code: 'not_a_student' });
    expect(w.calls).toHaveLength(0);
  });

  it('siswa: workspace/siswa/kelas dari Firestore; body tak bisa mengaku kelas/siswa lain', async () => {
    await runAction('student.list', 'anon1', { ws: 'wsB', studentId: 's9', className: '8A' }, w.deps);
    expect(w.calls[0].args).toEqual({ p_ws: 'wsA', p_student_id: 's1', p_class: '7A' });
    await runAction('attempt.start', 'anon1', { examId: UUID, studentId: 's2', className: '7B', uid: 'lain' }, w.deps);
    expect(w.calls[1]).toEqual({ name: 'ulh_start_attempt', args: { p_ws: 'wsA', p_uid: 'anon1', p_student_id: 's1', p_class: '7A', p_exam_id: UUID } });
  });

  it('tingkat attempt: hanya uid dari token, tanpa baca Firestore; input divalidasi', async () => {
    const reads = vi.spyOn(w.src, 'getDoc');
    await runAction('attempt.answer', 'anon1', { attemptId: UUID, questionId: UUID, optionId: UUID, seq: 7, uid: 'lain', score: 100 }, w.deps);
    expect(w.calls[0]).toEqual({ name: 'ulh_save_answer', args: { p_uid: 'anon1', p_attempt_id: UUID, p_question_id: UUID, p_option_id: UUID, p_client_seq: 7 } });
    await runAction('attempt.answer', 'anon1', { attemptId: UUID, questionId: UUID, optionId: null }, w.deps);
    expect(w.calls[1].args).toMatchObject({ p_option_id: null, p_client_seq: 0 });
    await runAction('attempt.get', 'anon1', { attemptId: UUID }, w.deps);
    await runAction('attempt.submit', 'anon1', { attemptId: UUID }, w.deps);
    await runAction('attempt.event', 'anon1', { attemptId: UUID, clientEventId: UUID, eventType: 'TAB_SWITCH', durationMs: 5000.4, occurredAt: '2026-01-01T00:00:00Z' }, w.deps);
    expect(w.calls[4].args).toMatchObject({ p_uid: 'anon1', p_event_type: 'TAB_SWITCH', p_duration_ms: 5000, p_metadata: {} });
    expect(reads).not.toHaveBeenCalled();
    for (const bad of [{ attemptId: 'x' }, { attemptId: UUID, questionId: 'x', optionId: UUID }, { attemptId: UUID, questionId: UUID, optionId: 'x' }, { attemptId: UUID, questionId: UUID, optionId: UUID, seq: -1 }, { attemptId: UUID, questionId: UUID, optionId: UUID, seq: 'abc' }])
      await expect(runAction('attempt.answer', 'anon1', bad, w.deps), JSON.stringify(bad)).rejects.toBeInstanceOf(BadRequest);
    await expect(runAction('attempt.event', 'anon1', { attemptId: UUID, clientEventId: 'x', eventType: 'TAB_SWITCH' }, w.deps)).rejects.toBeInstanceOf(BadRequest);
    await expect(runAction('exam.publish', 'guru', { id: "x'; drop table" }, w.deps)).rejects.toBeInstanceOf(BadRequest);
  });

  it('rekap: peserta = roster kelas (Firestore) + yang sudah mengerjakan walau pindah kelas; yang belum mulai tampil; ringkasan dihitung', async () => {
    w.rpcImpl.fn = async () => ({
      exam: { id: UUID, title: 'UH', status: 'published', class_names: ['7A'], question_count: 3, server_now: 'n' },
      attempts: [
        { attempt_id: 'a1', student_id: 's1', class_name: '7A', status: 'submitted', answered_count: 3, score: 100, max_score: 3, correct_count: 3, leave_count: 1, max_warning_level: 1 },
        { attempt_id: 'a3', student_id: 's3', class_name: '7A', status: 'active', answered_count: 1, score: null, leave_count: 0, max_warning_level: 0 }, // sekarang di 7B, mengerjakan saat 7A
      ],
    });
    const r = (await runAction('exam.results', 'guru', { id: UUID }, w.deps)) as { rows: Doc[]; summary: Doc };
    expect(r.rows.map((x) => [x.student_id, x.name, x.status, x.score])).toEqual([['s1', 'Budi', 'submitted', 100], ['s3', 'Dewi', 'active', null], ['s2', 'Sari', 'not_started', null]]);
    expect(r.rows.find((x) => x.student_id === 's2')).toMatchObject({ attempt_id: null, total_questions: 3, answered_count: 0 });
    expect(r.summary).toEqual({ assigned: 3, started: 2, submitted: 1, avg_score: 100, min_score: 100, max_score: 100 });
    expect(w.calls[0].args).toEqual({ p_ws: 'wsA', p_uid: 'guru', p_admin: false, p_id: UUID });
  });
});

// ---------- Route handler ----------
const verifyIdToken = vi.fn();
const ulanganRpc = vi.fn();
const docGet = vi.fn();
class FakeDbError extends Error {
  constructor(message: string, public status: number, public code?: string, public kind: 'config' | 'network' | 'db' = 'db') { super(message); this.name = 'UlanganDbError'; }
}
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminDb: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({ get: async () => docGet(c, id) }),
      where: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: false }) }), get: async () => ({ docs: [] }) }) }),
    }),
  }),
}));
vi.mock('@/lib/server/ulanganSupabase', () => ({ ulanganRpc: (...a: unknown[]) => ulanganRpc(...a), UlanganDbError: FakeDbError }));

describe('POST /api/ulangan', () => {
  const req = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer tok' }) =>
    new Request('http://x/api/ulangan', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never;
  const exists = (data: Record<string, unknown>) => ({ exists: true, data: () => data });
  const none = { exists: false, data: () => undefined };
  const post = async (r: unknown) => (await import('../app/api/ulangan/route')).POST(r as never);
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_ULANGAN_ENABLED = 'yes';
    verifyIdToken.mockReset().mockResolvedValue({ uid: 'guru' });
    ulanganRpc.mockReset().mockResolvedValue([]);
    docGet.mockReset().mockImplementation(async (c: string, id: string) => {
      if (c === 'teacher_profiles' && id === 'guru') return exists({ workspaceId: 'wsA', role: 'TEACHER' });
      if (c === 'workspaces' && id === 'wsA') return exists({ ownerUid: 'owner' });
      if (c === 'student_profiles' && id === 'siswa') return exists({ studentId: 's1', workspaceId: 'wsA' });
      if (c === 'students' && id === 's1') return exists({ workspaceId: 'wsA', className: '7A', name: 'Budi' });
      return none;
    });
  });

  it('default mati (501) tanpa menyentuh Firebase/Supabase; tanpa token 401; token invalid 401; aksi asing 400; body besar 413', async () => {
    process.env.NEXT_PUBLIC_ULANGAN_ENABLED = '';
    expect((await post(req({ action: 'exam.list' }))).status).toBe(501);
    expect(verifyIdToken).not.toHaveBeenCalled();
    process.env.NEXT_PUBLIC_ULANGAN_ENABLED = 'yes';
    expect((await post(req({ action: 'exam.list' }, {}))).status).toBe(401);
    expect((await post(req({ action: 'hapus.semua' }))).status).toBe(400);
    expect((await post(req('bukan json'))).status).toBe(400);
    expect((await post(req([1, 2]))).status).toBe(400);
    expect((await post(req({ action: 'exam.list' }, { authorization: 'Bearer t', 'content-length': '9999999' }))).status).toBe(413);
    expect((await post(req({ action: 'exam.save', pad: 'x'.repeat(300_000) }))).status).toBe(413);
    verifyIdToken.mockRejectedValue(new Error('expired'));
    expect((await post(req({ action: 'exam.list' }))).status).toBe(401);
    expect(ulanganRpc).not.toHaveBeenCalled();
  });

  it('cek pencabutan token hanya untuk aksi penentu hak (guru, daftar/mulai siswa); autosave/submit tanpa baca Firestore', async () => {
    await post(req({ action: 'exam.list' }));
    expect(verifyIdToken).toHaveBeenLastCalledWith('tok', true);
    verifyIdToken.mockResolvedValue({ uid: 'siswa' });
    await post(req({ action: 'student.list' }));
    expect(verifyIdToken).toHaveBeenLastCalledWith('tok', true);
    docGet.mockClear();
    const res = await post(req({ action: 'attempt.answer', attemptId: '11111111-1111-4111-8111-111111111111', questionId: '11111111-1111-4111-8111-111111111111', optionId: null, seq: 3 }));
    expect(res.status).toBe(200);
    expect(verifyIdToken).toHaveBeenLastCalledWith('tok', false);
    expect(docGet).not.toHaveBeenCalled();
    const [path, init] = ulanganRpc.mock.calls.at(-1)!;
    expect(path).toBe('ulh_save_answer');
    expect(init).toMatchObject({ p_uid: 'siswa', p_client_seq: 3 });
  });

  it('identitas dari Firestore: guru → workspace dari profil; siswa memanggil aksi guru → 403 not_a_teacher', async () => {
    const ok = await post(req({ action: 'exam.list', ws: 'wsZ', p_ws: 'wsZ' }));
    expect(ok.status).toBe(200);
    expect(ulanganRpc.mock.calls[0][1]).toEqual({ p_ws: 'wsA', p_uid: 'guru', p_admin: false });
    ulanganRpc.mockClear();
    verifyIdToken.mockResolvedValue({ uid: 'siswa' });
    const denied = await post(req({ action: 'exam.list' }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'not_a_teacher' });
    verifyIdToken.mockResolvedValue({ uid: 'asing' });
    expect((await post(req({ action: 'student.list' }))).status).toBe(403);
    expect(ulanganRpc).not.toHaveBeenCalled();
  });

  it('log server tidak memuat secret, URL/host, atau isi input klien (hanya jenis/status/kode)', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = { action: 'exam.publish', id: '11111111-1111-4111-8111-111111111111' };
    ulanganRpc.mockRejectedValueOnce(new FakeDbError('connect ECONNREFUSED https://abcdefghijklmnopqrst.supabase.co key=sb_secret_XYZ body=INPUT_KLIEN', 500, 'XX000'));
    await post(req(body));
    ulanganRpc.mockRejectedValueOnce(new FakeDbError('server_config', 503, undefined, 'config'));
    await post(req(body));
    ulanganRpc.mockRejectedValueOnce(new Error('boom sb_secret_XYZ https://abcdefghijklmnopqrst.supabase.co'));
    const r = await post(req(body));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/sb_secret|supabase\.co|boom/);
    expect(logs).toHaveBeenCalled();
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/sb_secret|supabase\.co|INPUT_KLIEN|ECONNREFUSED|boom/); // semua panggilan log, termasuk galat tak terduga
    logs.mockRestore();
  });

  it('galat basis data dipetakan: 42501→403, P0001→409 (kode), 22023→400, lainnya→502 tanpa bocor detail', async () => {
    const body = { action: 'exam.publish', id: '11111111-1111-4111-8111-111111111111' };
    ulanganRpc.mockRejectedValueOnce(new FakeDbError('exam_not_found', 403, '42501'));
    let r = await post(req(body)); expect([r.status, await r.json()]).toEqual([403, { error: 'exam_not_found' }]);
    ulanganRpc.mockRejectedValueOnce(new FakeDbError('exam_locked', 409, 'P0001'));
    r = await post(req(body)); expect([r.status, await r.json()]).toEqual([409, { error: 'exam_locked' }]);
    ulanganRpc.mockRejectedValueOnce(new FakeDbError('invalid_duration', 400, '22023'));
    r = await post(req(body)); expect(r.status).toBe(400);
    ulanganRpc.mockRejectedValueOnce(new FakeDbError('connection to 10.0.0.5 SECRET refused', 500, 'XX000'));
    r = await post(req(body));
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toMatch(/SECRET|10\.0/);
  });
});
