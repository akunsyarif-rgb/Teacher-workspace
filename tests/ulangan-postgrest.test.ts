import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createDatabase, psql } from './ulangan/harness';
import { SETUP } from './ulangan/fixtures';
import { runAction, type Deps } from '../lib/server/ulanganActions';
import type { Doc, IdentitySources } from '../lib/server/ulanganAuth';

// Uji HTTP terhadap PostgREST NYATA (biner resmi v12.2.3) + Postgres LOKAL: lapisan aksi server (runAction, identitas dari Firestore PALSU)
// memanggil RPC lewat HTTP dengan JWT service_role — jalur yang sama dengan route produksi. Dibuktikan juga: klien/anon/JWT palsu tidak
// punya jalan masuk, tabel tak terekspos, hanya 14 RPC yang terlihat. BUKAN Supabase cloud (gateway, kunci API, kebijakan platform).
//   POSTGREST_BIN=/path/postgrest RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-postgrest.test.ts
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const bin = process.env.POSTGREST_BIN;
const suite = adminUrl && bin ? describe : describe.skip;

const SECRET = 'test-only-secret-test-only-secret-0123456789';
const PORT = 3400 + Math.floor(Math.random() * 400);
const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function sign(claims: Record<string, unknown>, secret = SECRET) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
const SVC = sign({ role: 'service_role' });

// Firestore palsu: workspace wsA (guru tA, admin), dua kelas, tiga siswa.
const docs: Record<string, Doc> = {
  'workspaces/wsA': { ownerUid: 'owner' }, 'workspaces/wsB': { ownerUid: 'ownerB' },
  'teacher_profiles/tA': { workspaceId: 'wsA', role: 'TEACHER' }, 'teacher_profiles/tB': { workspaceId: 'wsB', role: 'TEACHER' },
  'student_profiles/uS1': { studentId: 's1', workspaceId: 'wsA' }, 'student_profiles/uS2': { studentId: 's2', workspaceId: 'wsA' },
  'student_profiles/uB1': { studentId: 'b1', workspaceId: 'wsB' },
  'students/s1': { workspaceId: 'wsA', className: '7A', name: 'Budi' }, 'students/s2': { workspaceId: 'wsA', className: '7B', name: 'Sari' },
  'students/s3': { workspaceId: 'wsA', className: '7A', name: 'Tono' }, 'students/b1': { workspaceId: 'wsB', className: '7A', name: 'Bima' },
};
const src: IdentitySources = {
  getDoc: async (c, id) => (docs[`${c}/${id}`] ? { ...docs[`${c}/${id}`] } : null),
  classExists: async (ws, cn) => Object.entries(docs).some(([k, v]) => k.startsWith('students/') && v.workspaceId === ws && v.className === cn),
  listStudents: async (ws, cns) => Object.entries(docs).filter(([k, v]) => k.startsWith('students/') && v.workspaceId === ws && cns.includes(String(v.className)))
    .map(([k, v]) => ({ id: k.split('/')[1], className: String(v.className), name: String(v.name) })),
};

suite('Ulangan Harian lewat PostgREST asli (runAction + RPC via HTTP service_role)', () => {
  let proc: ChildProcess | undefined;
  let drop = () => {};
  const http = (path: string, init: RequestInit & { token?: string } = {}) =>
    fetch(`http://127.0.0.1:${PORT}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...((init.headers as Record<string, string>) ?? {}) },
    });
  // Sama dengan serviceRequest produksi: POST /rpc/<fn> dengan kunci service; galat PostgREST → objek berkode seperti SupabaseServerError.
  const rpc: Deps['rpc'] = async (name, args) => {
    const r = await http(`/rpc/${name}`, { method: 'POST', token: SVC, body: JSON.stringify(args) });
    const text = await r.text();
    const body = text ? JSON.parse(text) : null;
    if (!r.ok) throw Object.assign(new Error(String(body?.message ?? r.status)), { status: r.status, code: body?.code });
    return body;
  };
  const deps: Deps = { rpc, src };
  const act = (a: Parameters<typeof runAction>[0], uid: string, body: Record<string, unknown> = {}) => runAction(a, uid, body, deps) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    const db = createDatabase(adminUrl as string, 'bypass'); // objek dimiliki role NOSUPERUSER BYPASSRLS (setara postgres Supabase)
    drop = db.drop;
    psql(db.url, [], SETUP);
    psql(adminUrl as string, ['-c', `do $$ begin if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'authpw'; end if; end $$`]);
    psql(db.url, ['-c', 'grant anon, authenticated, service_role to authenticator']);
    const u = new URL(db.url);
    u.username = 'authenticator'; u.password = 'authpw';
    proc = spawn(bin as string, [], {
      env: { PATH: process.env.PATH ?? '', PGRST_DB_URI: u.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET,
        PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(PORT), PGRST_LOG_LEVEL: 'warn' } as unknown as NodeJS.ProcessEnv,
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).status < 500) return; } catch { /* belum siap */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('PostgREST tidak siap');
  }, 60_000);
  afterAll(() => { proc?.kill(); drop(); });

  it('alur penuh guru → siswa → rekap lewat aksi server; skor dihitung server; rekap memuat yang belum mulai', async () => {
    const examId = await act('exam.save', 'tA', { exam: {
      title: 'UH HTTP', subject: 'IPA', duration_minutes: 30, opens_at: '2000-01-01T00:00:00Z', closes_at: '2999-01-01T00:00:00Z', class_names: ['7A'], shuffle: true, show_result: true,
      questions: [{ body: 'Q1', options: ['a', 'b', 'c', 'd'], correct_index: 1 }, { body: 'Q2', options: ['a', 'b', 'c', 'd'], correct_index: 2 }],
    } });
    expect(examId).toMatch(/^[0-9a-f-]{36}$/);
    const detail = await act('exam.get', 'tA', { id: examId });
    expect(detail.questions.map((q: any) => q.correct_index)).toEqual([1, 2]); // eslint-disable-line @typescript-eslint/no-explicit-any
    await act('exam.publish', 'tA', { id: examId });

    expect((await act('student.list', 'uS1')).exams.map((e: any) => e.id)).toEqual([examId]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await act('student.list', 'uS2')).exams).toEqual([]); // 7B
    expect((await act('student.list', 'uB1')).exams).toEqual([]); // 7A di workspace lain
    await expect(act('attempt.start', 'uS2', { examId })).rejects.toMatchObject({ status: 403, code: '42501' });
    await expect(act('attempt.start', 'uB1', { examId })).rejects.toMatchObject({ status: 403 });
    const att = await act('attempt.start', 'uS1', { examId });
    expect((await act('attempt.start', 'uS1', { examId })).id).toBe(att.id);
    const view = await act('attempt.get', 'uS1', { attemptId: att.id });
    expect(view.questions).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/correct|key/i);
    await expect(act('attempt.get', 'uS2', { attemptId: att.id })).rejects.toMatchObject({ status: 403 }); // bukan pemilik
    const q1 = detail.questions[0]; const q2 = detail.questions[1];
    expect(await act('attempt.answer', 'uS1', { attemptId: att.id, questionId: q1.id, optionId: q1.options[1].id, seq: 2 })).toBe(true);
    expect(await act('attempt.answer', 'uS1', { attemptId: att.id, questionId: q1.id, optionId: q1.options[0].id, seq: 1 })).toBe(false); // seq lama
    expect(await act('attempt.answer', 'uS1', { attemptId: att.id, questionId: q2.id, optionId: q2.options[0].id, seq: 3 })).toBe(true);
    const done = await act('attempt.submit', 'uS1', { attemptId: att.id });
    expect(done.result).toEqual({ score: 50, max_score: 2, correct_count: 1 });
    expect((await act('attempt.submit', 'uS1', { attemptId: att.id })).result).toEqual(done.result);
    await expect(act('attempt.answer', 'uS1', { attemptId: att.id, questionId: q2.id, optionId: q2.options[2].id, seq: 9 })).rejects.toMatchObject({ status: 400, code: 'P0001', message: 'attempt_not_active' }); // PostgREST: P0001 → HTTP 400; route memetakan berdasarkan kode → 409

    const res = await act('exam.results', 'tA', { id: examId });
    expect(res.summary).toMatchObject({ assigned: 2, started: 1, submitted: 1, avg_score: 50 }); // s1 selesai; s3 (7A) belum mulai
    expect(res.rows.map((r: any) => [r.name, r.status])).toEqual([['Budi', 'submitted'], ['Tono', 'not_started']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(act('exam.results', 'tB', { id: examId })).rejects.toMatchObject({ status: 403 }); // guru workspace lain
    expect(await act('exam.list', 'tB')).toEqual([]);
  }, 60_000);

  it('klien/anon/JWT palsu: tidak bisa memanggil RPC maupun membaca/menulis tabel lewat REST', async () => {
    const authed = sign({ sub: 'uS1', role: 'authenticated' });
    const anonKey = undefined;
    for (const fn of ['ulh_list_exams', 'ulh_get_attempt', 'ulh_list_student_exams', 'ulh_start_attempt']) {
      for (const token of [authed, anonKey]) expect([401, 403, 404], `${fn} ${token ? 'authenticated' : 'anon'}`).toContain((await http(`/rpc/${fn}`, { method: 'POST', token, body: '{}' })).status); // 404 = tak terlihat bagi peran itu
    }
    for (const t of ['ulh_exams', 'ulh_question_keys', 'ulh_attempts', 'ulh_answers', 'ulh_questions', 'ulh_options']) {
      for (const token of [authed, SVC, anonKey]) expect([401, 403], `${t} ${token === SVC ? 'service_role' : 'lain'}`).toContain((await http(`/${t}?select=*`, { token })).status); // tanpa hak tabel, bahkan service_role (anon tanpa token: 401)
    }
    for (const [method, path, body] of [['PATCH', '/ulh_attempts?id=not.is.null', { score: 100 }], ['POST', '/ulh_exams', { workspace_id: 'wsA', title: 'x' }], ['DELETE', '/ulh_exams?id=not.is.null', {}]] as const) {
      for (const token of [authed, SVC]) expect((await http(path, { method, token, body: JSON.stringify(body) })).status, `${method} ${path}`).toBe(403);
    }
    // JWT: kedaluwarsa, tanda tangan salah, service_role palsu
    expect((await http('/rpc/ulh_list_exams', { method: 'POST', body: '{}', token: sign({ role: 'service_role', exp: Math.floor(Date.now() / 1000) - 3600 }) })).status).toBe(401);
    const forged = sign({ role: 'service_role' }, 'rahasia-lain-rahasia-lain-rahasia-lain');
    expect((await http('/rpc/ulh_list_exams', { method: 'POST', body: JSON.stringify({ p_ws: 'wsA', p_uid: 'x', p_admin: true }), token: forged })).status).toBe(401);
  });

  it('hanya 14 RPC ulangan yang terekspos (untuk service_role); fungsi private tidak bisa dipanggil', async () => {
    const spec = (await (await http('/', { token: SVC })).json()) as { paths?: Record<string, unknown> };
    expect(Object.keys(spec.paths ?? {}).filter((p) => p.startsWith('/rpc/')).sort()).toHaveLength(14);
    for (const fn of ['ulh_finalize', 'ulh_need', 'ulh_touch', 'ulh_attempt_summary']) {
      const r = await http(`/rpc/${fn}`, { method: 'POST', token: SVC, body: '{}' });
      expect([403, 404], fn).toContain(r.status);
    }
  });
});
