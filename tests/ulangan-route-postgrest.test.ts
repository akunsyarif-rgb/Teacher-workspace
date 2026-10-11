import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDatabase, psql } from './ulangan/harness';
import { SETUP } from './ulangan/fixtures';

// Rantai HTTP penuh LOKAL: handler Next `POST /api/ulangan` (NYATA) → ulanganRpc (NYATA, kunci secret dikirim sebagai header) → gateway lokal
// kecil (meniru gateway Supabase: cek apikey, awalan /rest/v1, ganti ke JWT service_role) → PostgREST asli v12.2.3 → Postgres lokal.
// Yang PALSU: Firebase Admin (verifikasi token & Firestore, in-memory). BUKAN bukti Supabase cloud / token Firebase asli.
//   POSTGREST_BIN=/path/postgrest RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-route-postgrest.test.ts
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const bin = process.env.POSTGREST_BIN;
const suite = adminUrl && bin ? describe : describe.skip;

const SECRET = 'test-only-secret-test-only-secret-0123456789';
const SECRET_KEY = 'sb_secret_testonly_000000000000';
const PORT = 3800 + Math.floor(Math.random() * 300);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SVC_JWT = (() => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ aud: 'authenticated', role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
})();

type Doc = Record<string, unknown>;
const docs: Record<string, Doc> = {
  'workspaces/wsA': { ownerUid: 'owner' }, 'workspaces/wsB': { ownerUid: 'ownerB' },
  'teacher_profiles/tA': { workspaceId: 'wsA', role: 'TEACHER', isActive: true }, 'teacher_profiles/tX': { workspaceId: 'wsA', role: 'TEACHER', isActive: true },
  'teacher_profiles/tB': { workspaceId: 'wsB', role: 'TEACHER', isActive: true }, 'teacher_profiles/owner': { workspaceId: 'wsA', role: 'OWNER' },
  'student_profiles/uS1': { studentId: 's1', workspaceId: 'wsA' }, 'student_profiles/uS2': { studentId: 's2', workspaceId: 'wsA' },
  'student_profiles/uB1': { studentId: 'b1', workspaceId: 'wsB' },
  'students/s1': { workspaceId: 'wsA', className: '7A', name: 'Budi' }, 'students/s2': { workspaceId: 'wsA', className: '7B', name: 'Sari' },
  'students/s3': { workspaceId: 'wsA', className: '7A', name: 'Tono' }, 'students/b1': { workspaceId: 'wsB', className: '7A', name: 'Bima' },
};
// token palsu: "ok:<uid>" valid; "revoked:<uid>" hanya ditolak bila diminta cek pencabutan; "expired" / "junk" ditolak dengan kode Firebase.
const verifyIdToken = vi.fn(async (token: string, checkRevoked?: boolean) => {
  const [kind, uid] = token.split(':');
  if (kind === 'ok') return { uid };
  if (kind === 'revoked') { if (checkRevoked) throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' }); return { uid }; }
  if (kind === 'expired') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' });
  throw Object.assign(new Error('junk'), { code: 'auth/argument-error' });
});
const snap = (d: Doc | undefined) => ({ exists: !!d, data: () => d });
const studentsWhere = (f: [string, unknown][]) => Object.entries(docs).filter(([k, v]) => k.startsWith('students/') && f.every(([key, val]) => v[key] === val))
  .map(([k, v]) => ({ id: k.split('/')[1], get: (x: string) => v[x] }));
vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken: (t: string, r?: boolean) => verifyIdToken(t, r) }),
  getAdminDb: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({ get: async () => snap(docs[`${c}/${id}`]) }),
      where: (k1: string, _o: string, v1: unknown) => ({
        where: (k2: string, _o2: string, v2: unknown) => ({
          limit: () => ({ get: async () => ({ empty: studentsWhere([[k1, v1], [k2, v2]]).length === 0 }) }),
          get: async () => ({ docs: studentsWhere([[k1, v1], [k2, v2]]) }),
        }),
      }),
    }),
  }),
}));

suite('POST /api/ulangan → ulanganRpc → PostgREST asli (identitas Firestore palsu)', () => {
  let pgrst: ChildProcess | undefined;
  let gw: http.Server | undefined;
  let drop = () => {};
  let dbUrl = '';
  const gwHits = { n: 0, badKey: 0 };
  const post = async (body: unknown, token: string | null = 'ok:tA') => {
    const { POST } = await import('../app/api/ulangan/route');
    const res = await POST(new Request('http://x/api/ulangan', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never);
    return { status: res.status, json: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const exam = (extra: Record<string, unknown> = {}) => ({
    title: 'UH Route', subject: 'IPA', duration_minutes: 30, opens_at: '2000-01-01T00:00:00Z', closes_at: '2999-01-01T00:00:00Z', class_names: ['7A'], shuffle: true, show_result: true,
    questions: [{ body: 'Q1', options: ['a', 'b', 'c', 'd'], correct_index: 1 }, { body: 'Q2', options: ['a', 'b', 'c', 'd'], correct_index: 2 }], ...extra,
  });

  beforeAll(async () => {
    const db = createDatabase(adminUrl as string, 'bypass');
    drop = db.drop; dbUrl = db.url;
    psql(db.url, [], SETUP);
    psql(adminUrl as string, ['-c', `do $$ begin if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'authpw'; end if; end $$`]);
    psql(db.url, ['-c', 'grant anon, authenticated, service_role to authenticator']);
    const u = new URL(db.url); u.username = 'authenticator'; u.password = 'authpw';
    pgrst = spawn(bin as string, [], {
      env: { PATH: process.env.PATH ?? '', PGRST_DB_URI: u.toString(), PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET,
        PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(PORT), PGRST_LOG_LEVEL: 'warn' } as unknown as NodeJS.ProcessEnv,
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).status < 500) break; } catch { /* belum siap */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    gw = http.createServer((req, res) => {
      gwHits.n++;
      if (req.headers.apikey !== SECRET_KEY) { gwHits.badKey++; res.writeHead(401).end('{"message":"Invalid API key"}'); return; }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const fwd = http.request({ host: '127.0.0.1', port: PORT, path: (req.url ?? '').replace(/^\/rest\/v1/, ''), method: req.method,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${SVC_JWT}` } }, (r) => { res.writeHead(r.statusCode ?? 502, { 'content-type': 'application/json' }); r.pipe(res); });
        fwd.end(Buffer.concat(chunks));
      });
    });
    await new Promise<void>((r) => gw!.listen(0, '127.0.0.1', r));
    process.env.NEXT_PUBLIC_ULANGAN_ENABLED = 'yes';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; // izinkan http lokal di ulanganSupabaseConfig (env ini tak ada di Vercel)
    process.env.SUPABASE_URL = `http://127.0.0.1:${(gw.address() as AddressInfo).port}`;
    process.env.SUPABASE_SECRET_KEY = SECRET_KEY;
    vi.resetModules();
  }, 60_000);
  afterAll(() => {
    pgrst?.kill(); gw?.close(); drop();
    for (const k of ['NEXT_PUBLIC_ULANGAN_ENABLED', 'FIRESTORE_EMULATOR_HOST', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY']) delete process.env[k];
  });

  it('autentikasi: tanpa/rusak/kedaluwarsa → 401 (token tak masuk respons); pencabutan hanya diperiksa untuk aksi penentu hak', async () => {
    expect((await post({ action: 'exam.list' }, null)).status).toBe(401);
    const junk = await post({ action: 'exam.list' }, 'junk');
    expect(junk.status).toBe(401); expect(junk.json.error).toContain('auth/argument-error');
    const exp = await post({ action: 'exam.list' }, 'expired');
    expect(exp.status).toBe(401); expect(exp.json.error).toContain('auth/id-token-expired');
    expect(JSON.stringify([junk.json, exp.json])).not.toMatch(/expired:|junk:/);
    expect((await post({ action: 'exam.list' }, 'revoked:tA')).status).toBe(401); // guru: cek pencabutan
    expect((await post({ action: 'exam.list' }, 'revoked:tA')).json.error).toContain('id-token-revoked');
    expect(await post({ action: 'nope' })).toMatchObject({ status: 400 });
    expect((await post('{rusak')).status).toBe(400);
    expect((await post({ action: 'exam.save', pad: 'x'.repeat(300 * 1024) })).status).toBe(413);
  });

  it('alur penuh lewat HTTP: guru buat/terbit, siswa mulai/autosave/submit, nilai server, rekap roster Firestore', async () => {
    const saved = await post({ action: 'exam.save', exam: exam(), workspaceId: 'wsB', p_ws: 'wsB', uid: 'tB', admin: true }); // klaim palsu di body
    expect(saved.status).toBe(200);
    const id = saved.json.data as string;
    expect((await post({ action: 'exam.get', id }, 'ok:tB')).status).toBe(403); // body tak memindahkan ulangan ke wsB
    expect((await post({ action: 'exam.get', id }, 'ok:tX')).status).toBe(403); // guru lain, workspace sama (bukan pembuat)
    expect((await post({ action: 'exam.get', id }, 'ok:owner')).status).toBe(200); // OWNER (admin) boleh
    const detail = (await post({ action: 'exam.get', id })).json.data;
    expect(detail.questions.map((q: any) => q.correct_index)).toEqual([1, 2]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await post({ action: 'exam.publish', id }, 'ok:tX')).status).toBe(403);
    expect((await post({ action: 'exam.publish', id })).status).toBe(200);
    expect((await post({ action: 'exam.save', exam: { ...exam(), id } })).status).toBe(409); // sudah terbit: terkunci (exam_locked)

    // identitas siswa dari Firestore: kelas salah / workspace salah / guru memanggil aksi siswa
    expect((await post({ action: 'student.list' }, 'ok:uS1')).json.data.exams.map((e: any) => e.id)).toEqual([id]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await post({ action: 'student.list' }, 'ok:uS2')).json.data.exams).toEqual([]); // 7B
    expect((await post({ action: 'student.list' }, 'ok:uB1')).json.data.exams).toEqual([]); // 7A tapi wsB
    expect((await post({ action: 'attempt.start', examId: id, className: '7A' }, 'ok:uS2')).status).toBe(403); // body mengaku kelas 7A
    expect((await post({ action: 'attempt.start', examId: id }, 'ok:uB1')).status).toBe(403);
    expect((await post({ action: 'attempt.start', examId: id }, 'ok:tA')).json.error).toBe('not_a_student');
    expect((await post({ action: 'exam.list' }, 'ok:uS1')).json.error).toBe('not_a_teacher');

    const att = (await post({ action: 'attempt.start', examId: id }, 'ok:uS1')).json.data;
    expect((await post({ action: 'attempt.start', examId: id }, 'ok:uS1')).json.data.id).toBe(att.id); // idempoten
    const view = (await post({ action: 'attempt.get', attemptId: att.id }, 'ok:uS1')).json.data;
    expect(JSON.stringify(view)).not.toMatch(/correct|is_right|"key"/i);
    expect((await post({ action: 'attempt.get', attemptId: att.id }, 'ok:uS2')).status).toBe(403); // bukan pemilik
    expect((await post({ action: 'attempt.get', attemptId: att.id }, 'ok:tA')).status).toBe(403);
    const q1 = detail.questions[0]; const q2 = detail.questions[1];
    const ans = (qid: string, oid: string, seq: number, token = 'ok:uS1') => post({ action: 'attempt.answer', attemptId: att.id, questionId: qid, optionId: oid, seq }, token);
    expect((await ans(q1.id, q1.options[1].id, 5)).json.data).toBe(true);
    expect((await ans(q1.id, q1.options[0].id, 2)).json.data).toBe(false); // seq lama (jaringan lambat) tak menimpa
    expect((await ans(q2.id, q1.options[1].id, 6)).status).toBe(409); // opsi milik soal lain
    expect((await ans(q2.id, q2.options[2].id, 7, 'ok:uS2')).status).toBe(403); // uid lain
    expect((await ans(q2.id, 'bukan-uuid', 8)).status).toBe(400);
    expect((await ans(q2.id, q2.options[2].id, 8, 'revoked:uS1')).status).toBe(200); // autosave: tanpa cek pencabutan/Firestore
    const done = await post({ action: 'attempt.submit', attemptId: att.id }, 'ok:uS1');
    expect(done.json.data.result).toEqual({ score: 100, max_score: 2, correct_count: 2 });
    expect((await post({ action: 'attempt.submit', attemptId: att.id }, 'ok:uS1')).json.data.result).toEqual(done.json.data.result); // submit ganda idempoten
    const late = await ans(q2.id, q2.options[0].id, 99);
    expect(late.status).toBe(409); expect(late.json.error).toBe('attempt_not_active');
    expect(psql(dbUrl, ['-c', `select count(*) from public.ulh_attempts where exam_id='${id}'`]).trim()).toBe('1');

    const res = (await post({ action: 'exam.results', id })).json.data;
    expect(res.summary).toMatchObject({ assigned: 2, started: 1, submitted: 1, avg_score: 100 });
    expect(res.rows.map((r: any) => [r.name, r.status])).toEqual([['Budi', 'submitted'], ['Tono', 'not_started']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await post({ action: 'exam.results', id }, 'ok:tB')).status).toBe(403);
    expect((await post({ action: 'exam.list' }, 'ok:tB')).json.data).toEqual([]);
  }, 60_000);

  it('manipulasi payload: kelas fiktif, UUID rusak, tipe salah, field asing → ditolak/dibuang; batas waktu server', async () => {
    expect((await post({ action: 'exam.save', exam: exam({ class_names: ['KELAS-FIKTIF'] }) })).status).toBe(400);
    expect((await post({ action: 'exam.save', exam: exam({ class_names: ['7B'], duration_minutes: -5 }) })).status).toBe(400);
    expect((await post({ action: 'exam.save', exam: exam({ questions: [] }) })).status).toBe(400);
    expect((await post({ action: 'exam.get', id: "x'; drop table ulh_exams;--" })).status).toBe(400);
    expect((await post({ action: 'exam.save', exam: exam({ class_names: ['7A'], workspace_id: 'wsB', created_by: 'tB', status: 'published' }) })).status).toBe(200);
    expect(psql(dbUrl, ['-c', `select count(*) from public.ulh_exams where workspace_id='wsB'`]).trim()).toBe('0'); // field asing dibuang
    expect(psql(dbUrl, ['-c', `select count(*) from public.ulh_exams where status='published' and workspace_id='wsA' and title='UH Route' and created_by='tA'`]).trim()).toBe('1'); // hanya yang diterbitkan eksplisit (alur 1); status dari body diabaikan

    // batas waktu: server menentukan; geser expires_at ke masa lalu = jam server melewati batas
    const id = (await post({ action: 'exam.save', exam: exam({ title: 'UH Waktu' }) })).json.data as string;
    await post({ action: 'exam.publish', id });
    const att = (await post({ action: 'attempt.start', examId: id }, 'ok:uS1')).json.data;
    const q = (await post({ action: 'attempt.get', attemptId: att.id }, 'ok:uS1')).json.data.questions[0];
    psql(dbUrl, ['-c', `update public.ulh_attempts set started_at = clock_timestamp() - interval '31 minutes', expires_at = clock_timestamp() - interval '1 minute' where id='${att.id}'`]);
    const late = await post({ action: 'attempt.answer', attemptId: att.id, questionId: q.id, optionId: q.options[0].id, seq: 1 }, 'ok:uS1');
    expect(late.status).toBe(409); expect(late.json.error).toBe('attempt_expired'); // klien memetakan ke "Waktu ujian sudah habis."
    await post({ action: 'attempt.submit', attemptId: att.id }, 'ok:uS1');
    expect(psql(dbUrl, ['-c', `select status from public.ulh_attempts where id='${att.id}'`]).trim()).toBe('expired');
  }, 60_000);

  it('kegagalan jaringan/konfigurasi: kunci salah → 502 tanpa bocor; gateway mati → 502; konfigurasi hilang → 503; flag mati → 501', async () => {
    const goodKey = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_salah';
    const badKey = await post({ action: 'exam.list' });
    expect(badKey.status).toBe(502); expect(gwHits.badKey).toBeGreaterThan(0);
    expect(JSON.stringify(badKey.json)).not.toMatch(/sb_secret|127\.0\.0\.1|Invalid API key/);
    process.env.SUPABASE_SECRET_KEY = goodKey;

    delete process.env.SUPABASE_SECRET_KEY;
    const cfg = await post({ action: 'exam.list' });
    expect(cfg.status).toBe(503); expect(cfg.json.error).toBe('server_config_key_missing');
    process.env.SUPABASE_SECRET_KEY = goodKey;

    const url = process.env.SUPABASE_URL;
    await new Promise<void>((r) => gw!.close(() => r()));
    gw = undefined;
    const down = await post({ action: 'exam.list' });
    expect(down.status).toBe(502);
    expect(JSON.stringify(down.json)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|sb_secret/);
    process.env.SUPABASE_URL = url;

    process.env.NEXT_PUBLIC_ULANGAN_ENABLED = '';
    expect((await post({ action: 'exam.list' })).status).toBe(501);
    process.env.NEXT_PUBLIC_ULANGAN_ENABLED = 'yes';
  }, 60_000);
});
