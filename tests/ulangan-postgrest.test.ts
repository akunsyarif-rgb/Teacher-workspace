import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createDatabase, psql } from './rls/harness';
import { SETUP } from './ulangan/fixtures';
import { createSupabaseAdapter, SupabaseAdapterError } from '../lib/adapters/supabaseAdapter';

// Uji HTTP end-to-end terhadap PostgREST NYATA (biner resmi v12.2.3) + Postgres LOKAL, memakai adapter & repository ASLI aplikasi.
// Yang dibuktikan di sini: bentuk galat PostgREST, grant/RLS lewat HTTP (bukan psql superuser), jalur JWT (role/sub/kedaluwarsa/tanda tangan),
// skema yang terekspos. YANG TIDAK dibuktikan: Supabase cloud (gateway, Third-Party Auth Firebase/JWKS, kebijakan platform, advisor).
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
const as = (sub: string) => sign({ sub, role: 'authenticated' });

let currentUser = 'teachA';
let sync: (roster: boolean) => Promise<void> = async () => {};

// Adapter ASLI diarahkan ke PostgREST lokal (gateway Supabase menambah awalan /rest/v1; PostgREST sendiri tidak).
const toLocal = (u: unknown, init?: RequestInit) => fetch(String(u).replace('/rest/v1/', '/'), init);
const adapterFor = (sub: string) => createSupabaseAdapter({ url: `http://127.0.0.1:${PORT}`, publishableKey: 'sb_publishable_local', getToken: async () => as(sub), fetchImpl: toLocal as typeof fetch });
vi.mock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => adapterFor(currentUser) }));
vi.mock('../lib/adapters/ulanganIdentityClient', () => ({ syncUlanganIdentity: (roster: boolean) => sync(roster) }));

suite('Ulangan Harian lewat PostgREST asli (adapter + repository aplikasi)', () => {
  let proc: ChildProcess | undefined;
  let drop = () => {};
  let dbUrl = '';
  const http = (path: string, init: RequestInit & { token?: string } = {}) =>
    fetch(`http://127.0.0.1:${PORT}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...((init.headers as Record<string, string>) ?? {}) },
    });

  beforeAll(async () => {
    const db = createDatabase(adminUrl as string, true, 'bypass'); // objek dimiliki role NOSUPERUSER BYPASSRLS (setara postgres Supabase)
    dbUrl = db.url;
    drop = db.drop;
    psql(dbUrl, [], SETUP);
    psql(adminUrl as string, ['-c', `do $$ begin if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'authpw'; end if; end $$`]);
    psql(dbUrl, ['-c', 'grant anon, authenticated, service_role to authenticator']);
    const u = new URL(dbUrl);
    u.username = 'authenticator'; u.password = 'authpw';
    proc = spawn(bin as string, [], {
      env: {
        PATH: process.env.PATH ?? '', PGRST_DB_URI: u.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET,
        PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(PORT), PGRST_LOG_LEVEL: 'warn',
      } as unknown as NodeJS.ProcessEnv,
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).status < 500) return; } catch { /* belum siap */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('PostgREST tidak siap');
  }, 60_000);
  afterAll(() => { proc?.kill(); drop(); });

  it('alur penuh guru → siswa lewat repository asli; skor dihitung server', async () => {
    const repo = await import('../lib/repositories/ulanganRepository');
    currentUser = 'teachA';
    const pkgId = await repo.savePackage({
      title: 'UH HTTP', subject: 'IPA', status: 'final',
      questions: [{ body: 'Q1', options: ['a', 'b', 'c', 'd'], correctIndex: 1 }, { body: 'Q2', options: ['a', 'b', 'c', 'd'], correctIndex: 2 }],
    });
    const detail = await repo.getPackage(pkgId);
    expect(detail.questions.map((q) => q.correctIndex)).toEqual([1, 2]);
    const examId = await repo.saveExam({
      packageId: pkgId, title: 'UH 1', durationMinutes: 30, opensAt: '2000-01-01T00:00:00Z', closesAt: '2999-01-01T00:00:00Z',
      classNames: ['7A'], shuffleQuestions: true, shuffleOptions: true, showResult: true,
    });
    await repo.publishExam(examId);

    currentUser = 'stuA1';
    const mine = await repo.listMyExams();
    expect(mine.exams.map((e) => e.id)).toEqual([examId]);
    const att = await repo.startAttempt(examId);
    expect((await repo.startAttempt(examId)).id).toBe(att.id); // idempoten lewat HTTP
    const view = await repo.getAttempt(att.id);
    expect(view.questions).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/correct|key/i);
    // jawab Q1 benar, Q2 salah (pakai id dari data guru)
    const q1 = detail.questions[0]; const q2 = detail.questions[1];
    expect(await repo.saveAnswer(att.id, q1.id, q1.options[1].id, 2)).toBe(true);
    expect(await repo.saveAnswer(att.id, q1.id, q1.options[0].id, 1)).toBe(false); // seq lama tidak menimpa
    expect(await repo.saveAnswer(att.id, q2.id, q2.options[0].id, 3)).toBe(true);
    const done = await repo.submitAttempt(att.id);
    expect(done.status).toBe('submitted');
    expect(done.result).toEqual({ score: 50, maxScore: 2, correctCount: 1 });
    expect((await repo.submitAttempt(att.id)).result).toEqual(done.result); // submit ganda aman
    await expect(repo.saveAnswer(att.id, q2.id, q2.options[2].id, 9)).rejects.toThrow(/attempt_not_active/);

    currentUser = 'teachA';
    const mon = await repo.getExamMonitor(examId);
    expect(mon.summary).toMatchObject({ assigned: 2, started: 1, submitted: 1, avgScore: 50 });
  }, 60_000);

  it('klien tidak bisa menulis/membaca tabel sensitif lewat REST; galat berbentuk 403 (bukan data)', async () => {
    const stu = as('stuA1');
    for (const t of ['ulh_question_keys', 'ulh_members', 'ulh_roster', 'ulh_audit_log']) {
      const r = await http(`/${t}?select=*`, { token: stu });
      if (['ulh_members', 'ulh_roster'].includes(t)) expect(r.status, t).toBe(403); // tanpa grant
      else { expect(r.status, t).toBe(200); expect(await r.json(), t).toEqual([]); } // RLS: 0 baris
    }
    const forge = { user_id: 'stuA1', kind: 'teacher', role: 'OWNER', workspace_id: 'wsA' };
    for (const [method, path, body] of [
      ['PATCH', '/ulh_attempts?id=not.is.null', { score: 100, status: 'submitted' }], ['DELETE', '/ulh_attempts?id=not.is.null', {}],
      ['POST', '/ulh_exams', { workspace_id: 'wsA', title: 'x' }], ['POST', '/ulh_members', forge], ['PATCH', '/ulh_members?user_id=eq.stuA1', { role: 'OWNER' }],
      ['POST', '/ulh_answers', { workspace_id: 'wsA' }], ['PATCH', '/ulh_question_keys?question_id=not.is.null', { workspace_id: 'wsA' }],
    ] as const) {
      expect((await http(path, { method, token: stu, body: JSON.stringify(body) })).status, `siswa ${method} ${path}`).toBe(403);
    }
    const t = as('teachA');
    for (const [method, path, body] of [
      ['PATCH', '/ulh_attempts?id=not.is.null', { score: 100 }], ['POST', '/ulh_members', forge], ['DELETE', '/ulh_exams?id=not.is.null', {}],
      ['PATCH', '/ulh_question_keys?question_id=not.is.null', { workspace_id: 'wsB' }], ['DELETE', '/ulh_audit_log?id=not.is.null', {}],
    ] as const) {
      expect((await http(path, { method, token: t, body: JSON.stringify(body) })).status, `guru ${method} ${path}`).toBe(403);
    }
  });

  it('JWT: tanpa token, kedaluwarsa, tanda tangan salah, role service_role palsu → ditolak', async () => {
    expect([401, 403]).toContain((await http('/rpc/ulh_list_my_exams', { method: 'POST', body: '{}' })).status); // anon: tak punya EXECUTE
    expect((await http('/rpc/ulh_list_my_exams', { method: 'POST', body: '{}', token: sign({ sub: 'stuA1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) - 3600 }) })).status).toBe(401);
    expect((await http('/rpc/ulh_list_my_exams', { method: 'POST', body: '{}', token: sign({ sub: 'stuA1', role: 'authenticated' }, 'rahasia-lain-rahasia-lain-rahasia-lain') })).status).toBe(401);
    const forged = sign({ sub: 'stuA1', role: 'service_role' }, 'rahasia-lain-rahasia-lain-rahasia-lain');
    expect((await http('/ulh_members?select=*', { token: forged })).status).toBe(401);
    // role authenticated tanpa sub → fungsi menolak (bukan anggota)
    const r = await http('/rpc/ulh_list_my_exams', { method: 'POST', body: '{}', token: sign({ role: 'authenticated' }) });
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).toMatch(/not_a_student/);
  });

  it('hanya fungsi publik ulh_* yang terekspos; fungsi private/ctx/finalize tidak dapat dipanggil', async () => {
    const t = as('teachA');
    for (const fn of ['ulh_finalize', 'ulh_teacher_ctx', 'ulh_student_ctx', 'ulh_manages_exam', 'ulh_audit', 'current_uid', 'batch_write_secret']) {
      const r = await http(`/rpc/${fn}`, { method: 'POST', token: t, body: '{}' });
      expect([401, 403, 404], fn).toContain(r.status);
      expect(r.status, fn).not.toBe(200);
    }
    const spec = await (await http('/', { token: t })).json() as { paths?: Record<string, unknown> };
    const rpcPaths = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith('/rpc/ulh_'));
    expect(rpcPaths).toHaveLength(17);
  });

  it('galat PostgREST nyata cocok dengan pola withIdentity/describeError; sinkronisasi lalu ulangi sekali', async () => {
    const controller = await import('../lib/controllers/ulanganController');
    const repo = await import('../lib/repositories/ulanganRepository');
    currentUser = 'guruBaru';
    const err = await repo.listExams().catch((e) => e);
    expect(err).toBeInstanceOf(SupabaseAdapterError);
    expect(err.kind).toBe('denied');
    expect(err.message).toMatch(controller.IDENTITY_STALE);
    // "server" memproyeksikan guru baru; withIdentity memanggil sinkronisasi lalu mengulang
    let syncCalls = 0;
    sync = async () => {
      syncCalls++;
      psql(dbUrl, ['-c', "insert into public.ulh_members(user_id, kind, workspace_id, role) values ('guruBaru','teacher','wsA','TEACHER') on conflict do nothing"]);
    };
    const exams = await controller.fetchExams();
    expect(syncCalls).toBe(1);
    expect(Array.isArray(exams)).toBe(true);
    currentUser = 'orangAsing'; // tetap ditolak setelah sinkronisasi (server tidak memproyeksikannya)
    sync = async () => { syncCalls++; };
    await expect(controller.fetchExams()).rejects.toThrow(/not_a_teacher/);
    expect(syncCalls).toBe(2);
    expect(controller.describeError(err)).toMatch(/berwenang/);
  });

  it('lintas workspace lewat HTTP: guru/siswa wsB tidak melihat ujian wsA', async () => {
    const repo = await import('../lib/repositories/ulanganRepository');
    currentUser = 'teachA';
    const [exam] = await repo.listExams();
    expect(exam).toBeTruthy();
    currentUser = 'teachB';
    expect(await repo.listExams()).toEqual([]);
    await expect(repo.getExamMonitor(exam.id)).rejects.toMatchObject({ kind: 'denied' });
    currentUser = 'stuB1';
    expect((await repo.listMyExams()).exams).toEqual([]);
    await expect(repo.startAttempt(exam.id)).rejects.toMatchObject({ kind: 'denied' });
  });
});
