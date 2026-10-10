import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, psql, type OwnerMode } from './rls/harness';

// Uji Ulangan Harian di Postgres LOKAL (BUKAN Supabase nyata): baseline + migrasi + fixture, peran authenticated/anon
// ditiru lewat stub auth (claim JWT `sub`). Tiap skenario = satu transaksi yang di-rollback.
//   RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-harian.test.ts
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

type Step = { as: string; sql: string; save?: string } | { raw: string; save?: string };
const as = (who: string, sql: string, save?: string): Step => ({ as: who, sql, save });
const raw = (sql: string, save?: string): Step => ({ raw: sql, save });
const K = (k: string) => `(select v from test.kv where k='${k}')::uuid`;
const q = (s: string) => `$j$${s}$j$`; // tag dalam; pembungkus run() memakai $q$
const outer = (s: string) => `$q$${s}$q$`;

const SETUP = `
create schema if not exists test;
create table test.kv (k text primary key, v text);
grant usage on schema test to authenticated, anon;
grant all on test.kv to authenticated, anon;
create or replace function test.call(qry text, save_as text default null) returns text language plpgsql as $$
declare r text;
begin
  execute qry into r;
  if save_as is not null then insert into test.kv values (save_as, r) on conflict (k) do update set v = excluded.v; end if;
  return 'ok:' || replace(coalesce(r, '<null>'), E'\\n', ' ');
exception when others then
  return 'err:' || sqlstate || ':' || replace(sqlerrm, E'\\n', ' ');
end $$;
grant execute on function test.call(text, text) to authenticated, anon;
-- Proyeksi identitas modul (di produksi ditulis server lewat service_role dari kebenaran Firestore). Meniru fixture RLS.
insert into public.ulh_members (user_id, kind, workspace_id, role) values
  ('ownerA', 'teacher', 'wsA', 'OWNER'), ('adminA', 'teacher', 'wsA', 'ADMIN'), ('teachA', 'teacher', 'wsA', 'TEACHER'),
  ('hmA', 'teacher', 'wsA', 'TEACHER'), ('ownerB', 'teacher', 'wsB', 'OWNER'), ('teachB', 'teacher', 'wsB', 'TEACHER');
insert into public.ulh_members (user_id, kind, workspace_id, student_id, class_name, name) values
  ('stuA1', 'student', 'wsA', 'sA1', '7A', 'Siswa A1'), ('stuA2', 'student', 'wsA', 'sA2', '7B', 'Siswa A2'),
  ('stuA3', 'student', 'wsA', 'sA3', '7A', 'Siswa A3'), ('stuB1', 'student', 'wsB', 'sB1', '7A', 'Siswa B1');
insert into public.ulh_roster (workspace_id, student_id, class_name, name) values
  ('wsA', 'sA1', '7A', 'Siswa A1'), ('wsA', 'sA2', '7B', 'Siswa A2'), ('wsA', 'sA3', '7A', 'Siswa A3'), ('wsB', 'sB1', '7A', 'Siswa B1');
`;

let url = '';
let drop = () => {};

function run(steps: Step[], target: string = url): string[] {
  const out: string[] = ['begin;'];
  steps.forEach((s, i) => {
    const save = s.save ? `'${s.save}'` : 'null';
    if ('raw' in s) {
      out.push('reset role;', `select '${i}|' || test.call(${outer(s.raw)}, ${save});`);
    } else {
      const claims = s.as === 'anon' ? '{"role":"anon"}' : JSON.stringify({ sub: s.as, role: 'authenticated' });
      out.push('reset role;', `set local role ${s.as === 'anon' ? 'anon' : 'authenticated'};`,
        `select set_config('request.jwt.claims', ${outer(claims)}, true) is null;`, `select '${i}|' || test.call(${outer(s.sql)}, ${save});`);
    }
  });
  out.push('rollback;');
  const res: string[] = [];
  for (const line of psql(target, [], out.join('\n')).split('\n')) {
    const m = line.match(/^(\d+)\|(.*)$/);
    if (m) res[Number(m[1])] = m[2];
  }
  return res;
}
const json = (s: string) => JSON.parse(s.replace(/^ok:/, ''));
const DENY = /^err:42501/;
const STATE = (msg: string) => new RegExp(`^err:P0001:${msg}`);

// ---------- Bahan paket & ujian ----------
const pkg = (extra: Record<string, unknown> = {}) => ({
  title: 'UH Bab 1', subject: 'Matematika', status: 'final',
  questions: [
    { body: 'Q1', options: ['a', 'b', 'c', 'd'], correct_index: 1 },
    { body: 'Q2', options: ['a', 'b', 'c', 'd'], correct_index: 0 },
    { body: 'Q3', options: ['a', 'b', 'c', 'd'], correct_index: 2 },
  ],
  ...extra,
});
const examJson = (extra: Record<string, unknown> = {}) => JSON.stringify({
  package_id: '__PKG__', title: 'UH 1', duration_minutes: 30, class_names: ['7A'],
  opens_at: '2000-01-01T00:00:00Z', closes_at: '2999-01-01T00:00:00Z', show_result: true, ...extra,
});
const saveExam = (who: string, extra: Record<string, unknown> = {}, save = 'exam'): Step => ({
  as: who, save,
  sql: `select public.ulh_save_exam((${q(examJson(extra))}::jsonb) || jsonb_build_object('package_id', (select v from test.kv where k='pkg')))`,
});
const savePkg = (who: string, p: unknown = pkg(), save = 'pkg'): Step => as(who, `select public.ulh_save_package(${q(JSON.stringify(p))}::jsonb)`, save);
const publish = (who = 'teachA'): Step => as(who, `select public.ulh_publish_exam(${K('exam')})`);

// id soal & opsi (via superuser) agar skenario bisa menjawab tanpa menebak urutan acak
const lookups = (): Step[] => {
  const s: Step[] = [];
  for (const n of ['Q1', 'Q2', 'Q3']) {
    s.push(raw(`select q.id from public.ulh_questions q where q.body='${n}' and q.package_id=${K('pkg')}`, `q_${n}`));
    for (const l of ['a', 'b', 'c', 'd'])
      s.push(raw(`select o.id from public.ulh_options o join public.ulh_questions q on q.id=o.question_id where q.body='${n}' and q.package_id=${K('pkg')} and o.label='${l}'`, `o_${n}_${l}`));
  }
  return s;
};
// Alur dasar: paket final + ujian terbit untuk kelas 7A, lalu siswa stuA1 memulai attempt.
const base = (): Step[] => [savePkg('teachA'), saveExam('teachA'), publish(), ...lookups()];
const start = (who = 'stuA1', save = 'att'): Step => as(who, `select (public.ulh_start_attempt(${K('exam')}))->>'id'`, save);
const answer = (who: string, qn: string, l: string, seq = 1, att = 'att'): Step =>
  as(who, `select public.ulh_save_answer(${K(att)}, ${K('q_' + qn)}, ${K(`o_${qn}_${l}`)}, ${seq})`);
const submit = (who = 'stuA1', att = 'att'): Step => as(who, `select public.ulh_submit_attempt(${K(att)})`);
const evt = (who: string, type: string, ms: number | null, id: string, att = 'att'): Step =>
  as(who, `select public.ulh_report_integrity_event(${K(att)}, '${id}'::uuid, '${type}', now(), ${ms ?? 'null'}, '{}')`);
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// Tiga cara memuat skema: superuser (cepat), dan pemilik NOSUPERUSER ala Supabase (`postgres`: BYPASSRLS=true, terverifikasi
// read-only di Workflow) serta kasus terburuk tanpa BYPASSRLS. Semua tetap Postgres LOKAL — bukan validasi Supabase nyata.
const MODES: { name: string; owner: OwnerMode }[] = [
  { name: 'superuser', owner: undefined },
  { name: 'pemilik NOSUPERUSER BYPASSRLS (setara postgres Supabase)', owner: 'bypass' },
  { name: 'pemilik NOSUPERUSER NOBYPASSRLS (kasus terburuk)', owner: 'nobypass' },
];
for (const mode of MODES) suite(`Ulangan Harian [${mode.name}]`, () => {
  beforeAll(() => {
    const db = createDatabase(adminUrl as string, true, mode.owner);
    url = db.url;
    drop = db.drop;
    psql(url, [], SETUP);
  }, 120_000);
  afterAll(() => drop());

  it('guru membuat paket → ujian → terbit; hanya kelas & workspace sendiri', () => {
    const r = run([savePkg('teachA'), saveExam('teachA'), publish(),
      as('teachA', 'select jsonb_array_length(public.ulh_list_exams())'),
      as('teachA', 'select jsonb_array_length(public.ulh_list_packages())'),
      saveExam('teachA', { class_names: ['9Z'] }, 'bad'), // kelas tidak ada di workspace
      saveExam('teachA', { class_names: [] }, 'bad2'),
      raw(`select workspace_id || '/' || created_by from public.ulh_exams where id=${K('exam')}`)]);
    expect(r[2]).toBe('ok:'); // void
    expect(r[3]).toBe('ok:1');
    expect(r[4]).toBe('ok:1');
    expect(r[5]).toMatch(STATE('class_not_found'));
    expect(r[6]).toMatch(/^err:22023/);
    expect(r[7]).toBe('ok:wsA/teachA'); // workspace & pembuat dari server
  });

  it('payload tidak bisa menyelundupkan workspace/pembuat; validasi paket', () => {
    const r = run([
      as('teachA', `select public.ulh_save_package(${q(JSON.stringify({ ...pkg(), workspace_id: 'wsB', created_by: 'ownerB' }))}::jsonb)`, 'pkg'),
      raw(`select workspace_id || '/' || created_by from public.ulh_packages where id=${K('pkg')}`),
      savePkg('teachA', pkg({ questions: [{ body: 'Q', options: ['a'], correct_index: 0 }] }), 'x1'),
      savePkg('teachA', pkg({ questions: [{ body: 'Q', options: ['a', 'b'], correct_index: 2 }] }), 'x2'),
      savePkg('teachA', pkg({ questions: [] }), 'x3'),
      savePkg('teachA', pkg({ status: 'hapus' }), 'x4'),
    ]);
    expect(r[1]).toBe('ok:wsA/teachA');
    for (const i of [2, 3, 4, 5]) expect(r[i]).toMatch(/^err:22023/);
  });

  it('isolasi lintas workspace & lintas guru (paket, ujian, monitor)', () => {
    const r = run([...base(), start(),
      as('teachB', 'select count(*) from public.ulh_packages'),
      as('teachB', 'select count(*) from public.ulh_exams'),
      as('teachB', 'select count(*) from public.ulh_attempts'),
      as('teachB', `select public.ulh_get_package(${K('pkg')})`),
      as('teachB', `select public.ulh_exam_monitor(${K('exam')})`),
      as('teachB', `select public.ulh_attempt_events(${K('att')})`),
      as('teachB', `select public.ulh_close_exam(${K('exam')})`),
      as('ownerB', `select public.ulh_publish_exam(${K('exam')})`),
      as('teachB', `select public.ulh_save_exam((${q(examJson())}::jsonb) || jsonb_build_object('package_id', (select v from test.kv where k='pkg')))`),
      // rekan guru satu workspace yang bukan pembuat tidak mengelola paket/ujian orang lain; OWNER/ADMIN boleh
      as('hmA', `select public.ulh_get_package(${K('pkg')})`),
      as('hmA', `select public.ulh_exam_monitor(${K('exam')})`),
      as('hmA', 'select count(*) from public.ulh_answers'),
      as('adminA', `select (public.ulh_get_package(${K('pkg')}))->>'title'`),
      as('ownerA', `select (public.ulh_exam_monitor(${K('exam')}))#>>'{exam,title}'`),
    ]);
    const o = base().length + 1;
    expect(r[o]).toBe('ok:0');
    expect(r[o + 1]).toBe('ok:0');
    expect(r[o + 2]).toBe('ok:0');
    for (const i of [3, 4, 5, 6, 7, 8]) expect(r[o + i]).toMatch(DENY);
    expect(r[o + 9]).toMatch(DENY);
    expect(r[o + 10]).toMatch(DENY);
    expect(r[o + 11]).toBe('ok:0');
    expect(r[o + 12]).toBe('ok:UH Bab 1');
    expect(r[o + 13]).toBe('ok:UH 1');
  });

  it('siswa hanya melihat/mengerjakan ujian kelasnya (lintas kelas & workspace ditolak)', () => {
    const r = run([...base(),
      as('stuA1', "select jsonb_array_length((public.ulh_list_my_exams())->'exams')"),
      as('stuA2', "select jsonb_array_length((public.ulh_list_my_exams())->'exams')"), // kelas 7B
      as('stuB1', "select jsonb_array_length((public.ulh_list_my_exams())->'exams')"), // 7A di workspace lain
      as('stuA2', `select public.ulh_start_attempt(${K('exam')})`),
      as('stuB1', `select public.ulh_start_attempt(${K('exam')})`),
      as('nobody', `select public.ulh_start_attempt(${K('exam')})`),
      start('stuA1'),
      as('stuB1', `select public.ulh_get_attempt(${K('att')})`),
      as('stuA2', `select public.ulh_get_attempt(${K('att')})`),
      as('stuA3', `select public.ulh_get_attempt(${K('att')})`), // sekelas tapi bukan pemilik attempt
    ]);
    const o = base().length;
    expect(r[o]).toBe('ok:1');
    expect(r[o + 1]).toBe('ok:0');
    expect(r[o + 2]).toBe('ok:0');
    for (const i of [3, 4, 5, 7, 8, 9]) expect(r[o + i]).toMatch(DENY);
    expect(r[o + 6]).toMatch(/^ok:/);
  });

  it('ujian draft tidak terlihat siswa; ujian terbit terkunci dari perubahan', () => {
    const r = run([savePkg('teachA'), saveExam('teachA'), ...lookups(),
      as('stuA1', "select jsonb_array_length((public.ulh_list_my_exams())->'exams')"),
      as('stuA1', `select public.ulh_start_attempt(${K('exam')})`),
      publish(),
      as('stuA1', "select jsonb_array_length((public.ulh_list_my_exams())->'exams')"),
      as('teachA', `select public.ulh_save_exam((${q(examJson({ title: 'diubah' }))}::jsonb) || jsonb_build_object('package_id', ${K('pkg')}::text, 'id', ${K('exam')}::text))`),
      as('teachA', `select public.ulh_save_package((${q(JSON.stringify(pkg()))}::jsonb) || jsonb_build_object('id', ${K('pkg')}::text))`),
      as('teachA', `select public.ulh_delete_package(${K('pkg')})`),
      as('teachA', `select public.ulh_delete_exam(${K('exam')})`),
    ]);
    const o = 2 + 15;
    expect(r[o]).toBe('ok:0');
    expect(r[o + 1]).toMatch(DENY);
    expect(r[o + 3]).toBe('ok:1');
    expect(r[o + 4]).toMatch(STATE('exam_locked'));
    expect(r[o + 5]).toMatch(STATE('package_locked'));
    expect(r[o + 6]).toMatch(STATE('package_in_use'));
    expect(r[o + 7]).toMatch(STATE('exam_locked'));
  });

  it('kunci jawaban tidak bocor ke siswa (tabel, RPC, bentuk payload)', () => {
    const r = run([...base(), start(),
      ...['ulh_question_keys', 'ulh_questions', 'ulh_options', 'ulh_exams', 'ulh_attempts', 'ulh_attempt_questions', 'ulh_answers', 'ulh_integrity_events', 'ulh_audit_log', 'ulh_packages', 'ulh_exam_classes']
        .map((t) => as('stuA1', `select count(*) from public.${t}`)),
      as('stuA1', `select public.ulh_get_package(${K('pkg')})`),
      as('stuA1', `select public.ulh_save_package(${q(JSON.stringify(pkg()))}::jsonb)`),
      as('anon', 'select count(*) from public.ulh_question_keys'),
      as('anon', 'select public.ulh_list_my_exams()'),
      as('stuA1', `select public.ulh_get_attempt(${K('att')})`),
      raw('select string_agg(k.option_id::text, \',\') from public.ulh_question_keys k'),
    ]);
    const o = base().length + 1;
    for (let i = 0; i < 11; i++) expect(r[o + i], `tabel ke-${i}`).toMatch(/^(ok:0|err:42501)/);
    expect(r[o + 11]).toMatch(DENY);
    expect(r[o + 12]).toMatch(DENY);
    expect(r[o + 13]).toMatch(DENY);
    expect(r[o + 14]).toMatch(DENY);
    const att = json(r[o + 15]);
    expect(att.questions).toHaveLength(3);
    for (const qq of att.questions) {
      expect(Object.keys(qq).sort()).toEqual(['body', 'id', 'options', 'points', 'position']);
      expect(qq.options).toHaveLength(4);
      for (const op of qq.options) expect(Object.keys(op).sort()).toEqual(['id', 'label']);
    }
    expect(JSON.stringify(att)).not.toMatch(/correct|key/i);
    expect(att.attempt.result).toBeNull();
  });

  it('penulisan langsung ke tabel ujian ditolak (skor/waktu/status/jawaban tidak bisa dimanipulasi)', () => {
    const r = run([...base(), start(), answer('stuA1', 'Q1', 'b'),
      as('stuA1', "update public.ulh_attempts set score = 100, status = 'submitted'"),
      as('stuA1', "update public.ulh_attempts set expires_at = now() + interval '9 days'"),
      as('stuA1', "insert into public.ulh_answers(attempt_id, question_id, workspace_id, option_id) select attempt_id, question_id, workspace_id, option_id from public.ulh_answers"),
      as('stuA1', 'delete from public.ulh_attempts'),
      as('stuA1', "insert into public.ulh_exams(workspace_id, package_id, created_by, title, duration_minutes, opens_at, closes_at) values ('wsA', gen_random_uuid(), 'stuA1', 'x', 5, now(), now() + interval '1 day')"),
      as('teachA', 'update public.ulh_attempts set score = 100'),
      as('teachA', "update public.ulh_question_keys set option_id = option_id"),
      as('teachA', "insert into public.ulh_audit_log(workspace_id, actor_uid, action, entity, entity_id) values ('wsA','teachA','x','x','x')"),
      as('ownerA', 'delete from public.ulh_audit_log'),
      as('teachA', 'update public.ulh_exams set workspace_id = \'wsB\''),
    ]);
    const o = base().length + 2;
    for (let i = 0; i < 10; i++) expect(r[o + i], `langkah ${i}`).toMatch(DENY);
    expect(r[base().length + 1]).toBe('ok:true');
  });

  it('penilaian server-side & submit idempoten; skor tidak datang dari klien', () => {
    const r = run([...base(), start(),
      answer('stuA1', 'Q1', 'b'), // benar
      answer('stuA1', 'Q2', 'd'), // salah
      // Q3 tidak dijawab
      as('stuA1', `select public.ulh_submit_attempt(${K('att')})`),
      as('stuA1', `select public.ulh_submit_attempt(${K('att')})`),
      answer('stuA1', 'Q3', 'c', 5), // setelah submit: ditolak
      raw(`select status || '|' || score || '|' || max_score || '|' || correct_count from public.ulh_attempts where id=${K('att')}`),
      as('teachA', `select (public.ulh_exam_monitor(${K('exam')}))->'summary'`),
    ]);
    const o = base().length;
    const s1 = json(r[o + 3]);
    const s2 = json(r[o + 4]);
    expect(s1.status).toBe('submitted');
    expect(s1.result).toEqual({ score: 33.33, max_score: 3, correct_count: 1 });
    expect({ ...s2, server_now: 0 }).toEqual({ ...s1, server_now: 0 }); // submit kedua = hasil identik
    expect(r[o + 5]).toMatch(STATE('attempt_not_active'));
    expect(r[o + 6]).toBe('ok:submitted|33.33|3|1');
    expect(json(r[o + 7])).toMatchObject({ assigned: 2, started: 1, submitted: 1, avg_score: 33.33 });
  });

  it('hasil disembunyikan dari siswa bila show_result=false', () => {
    const r = run([savePkg('teachA'), saveExam('teachA', { show_result: false }), publish(), ...lookups(), start(), answer('stuA1', 'Q1', 'b'), submit(),
      as('stuA1', "select (public.ulh_list_my_exams())->'exams'->0->'attempt'->'result'")]);
    const o = 2 + 15 + 1 + 1;
    expect(json(r[o + 1]).result).toBeNull();
    expect(r[o + 2]).toBe('ok:null');
  });

  it('timer server: attempt dibatasi durasi & penutupan; jawaban/submit setelah batas ditolak', () => {
    const r = run([savePkg('teachA'), saveExam('teachA', { duration_minutes: 30, closes_at: new Date(Date.now() + 10 * 60_000).toISOString() }), publish(), ...lookups(),
      start(),
      raw(`select extract(epoch from expires_at - started_at)::int from public.ulh_attempts where id=${K('att')}`),
      answer('stuA1', 'Q1', 'b', 1), // sebelum batas: diterima
      // majukan waktu: mulai 2 jam lalu, habis semenit lalu
      raw(`update public.ulh_attempts set started_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id=${K('att')} returning id`),
      answer('stuA1', 'Q2', 'a', 2), // setelah batas: ditolak
      as('stuA1', `select public.ulh_submit_attempt(${K('att')})`),
      as('stuA1', `select public.ulh_get_attempt(${K('att')})`),
      raw(`select status || '|' || correct_count || '|' || max_score from public.ulh_attempts where id=${K('att')}`),
    ]);
    const o = 2 + 15 + 1;
    const dur = Number(r[o + 1].replace('ok:', ''));
    expect(dur).toBeLessThanOrEqual(10 * 60); // dibatasi closes_at, bukan 30 menit
    expect(dur).toBeGreaterThan(9 * 60 - 5);
    expect(r[o + 2]).toBe('ok:true');
    expect(r[o + 4]).toMatch(STATE('attempt_expired'));
    expect(json(r[o + 5]).status).toBe('expired');
    expect(json(r[o + 6]).questions).toEqual([]); // soal tidak dikirim lagi
    expect(r[o + 7]).toBe('ok:expired|1|3'); // hanya jawaban sebelum batas yang dinilai
  });

  it('jendela ujian: belum dibuka / sudah ditutup ditolak; start idempoten', () => {
    const r = run([savePkg('teachA'), saveExam('teachA', { opens_at: '2999-01-01T00:00:00Z', closes_at: '2999-02-01T00:00:00Z' }), publish(), ...lookups(),
      as('stuA1', `select public.ulh_start_attempt(${K('exam')})`),
      as('teachA', `select public.ulh_close_exam(${K('exam')})`),
      as('stuA1', `select public.ulh_start_attempt(${K('exam')})`),
    ]);
    const o = 2 + 15 + 1;
    expect(r[o]).toMatch(STATE('exam_not_open'));
    expect(r[o + 2]).toMatch(STATE('exam_not_open'));
    const r2 = run([...base(), start(), start('stuA1', 'att2'),
      raw(`select count(*) from public.ulh_attempts where exam_id=${K('exam')}`),
      raw(`select (v = (select v from test.kv where k='att2'))::text from test.kv where k='att'`)]);
    const o2 = base().length;
    expect(r2[o2 + 2]).toBe('ok:1');
    expect(r2[o2 + 3]).toBe('ok:true');
    // publish dengan jadwal lewat ditolak
    const r3 = run([savePkg('teachA'), saveExam('teachA', { opens_at: '2000-01-01T00:00:00Z', closes_at: '2001-01-01T00:00:00Z' }), publish()]);
    expect(r3[2]).toMatch(STATE('schedule_in_past'));
  });

  it('autosave: idempoten, monoton (seq lama tidak menimpa), validasi soal/opsi, pemilik attempt', () => {
    const r = run([...base(), start(),
      answer('stuA1', 'Q1', 'b', 2),
      answer('stuA1', 'Q1', 'b', 2), // ulang sama persis
      answer('stuA1', 'Q1', 'c', 1), // datang terlambat (seq lebih lama)
      answer('stuA1', 'Q1', 'd', 3), // lebih baru
      raw(`select option_id = ${K('o_Q1_d')}::text::uuid from public.ulh_answers where attempt_id=${K('att')} and question_id=${K('q_Q1')}`),
      raw(`select count(*) from public.ulh_answers where attempt_id=${K('att')}`),
      as('stuA1', `select public.ulh_save_answer(${K('att')}, ${K('q_Q1')}, ${K('o_Q2_a')}, 4)`), // opsi soal lain
      as('stuA1', `select public.ulh_save_answer(${K('att')}, gen_random_uuid(), ${K('o_Q1_a')}, 4)`), // soal tak ada
      as('stuA3', `select public.ulh_save_answer(${K('att')}, ${K('q_Q1')}, ${K('o_Q1_a')}, 9)`), // bukan pemilik
      as('stuB1', `select public.ulh_save_answer(${K('att')}, ${K('q_Q1')}, ${K('o_Q1_a')}, 9)`),
      as('stuA1', `select public.ulh_save_answer(${K('att')}, ${K('q_Q1')}, null, 5)`), // hapus jawaban
      raw(`select count(*) from public.ulh_answers where attempt_id=${K('att')}`),
    ]);
    const o = base().length + 1;
    expect(r[o]).toBe('ok:true');
    expect(r[o + 1]).toBe('ok:true'); // upsert sama: tetap menjawab benar, hasil tidak berubah
    expect(r[o + 2]).toBe('ok:false'); // seq 1 < 2: tidak diterapkan
    expect(r[o + 3]).toBe('ok:true');
    expect(r[o + 4]).toBe('ok:true');
    expect(r[o + 5]).toBe('ok:1');
    expect(r[o + 6]).toMatch(STATE('option_not_for_question'));
    expect(r[o + 7]).toMatch(STATE('question_not_in_attempt'));
    expect(r[o + 8]).toMatch(DENY);
    expect(r[o + 9]).toMatch(DENY);
    expect(r[o + 10]).toBe('ok:true');
    expect(r[o + 11]).toBe('ok:0');
  });

  it('blueprint acak tersimpan stabil; semua soal & opsi ada', () => {
    const r = run([...base(), start(),
      as('stuA1', `select (public.ulh_get_attempt(${K('att')}))->'questions'`, 'g1'),
      as('stuA1', `select (public.ulh_get_attempt(${K('att')}))->'questions'`, 'g2'),
      raw("select (select v from test.kv where k='g1') = (select v from test.kv where k='g2')")]);
    const o = base().length + 1;
    expect(r[o + 2]).toBe('ok:true');
    expect(json(r[o]).map((x: { body: string }) => x.body).sort()).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('integritas: ambang >3 dtk, peringatan bertingkat, idempoten, tanpa sanksi otomatis, guru memantau', () => {
    const r = run([...base(), start(),
      evt('stuA1', 'TAB_SWITCH', 2000, uid(1)), // di bawah ambang
      evt('stuA1', 'TAB_SWITCH', 3000, uid(2)), // tepat 3 dtk: belum melebihi
      evt('stuA1', 'TAB_SWITCH', 4000, uid(3)), // level 1
      evt('stuA1', 'WINDOW_BLUR', 5000, uid(4)), // level 2
      evt('stuA1', 'VISIBILITY_LOST', 6000, uid(5)), // level 3
      evt('stuA1', 'TAB_SWITCH', 7000, uid(6)), // tetap 3
      evt('stuA1', 'TAB_SWITCH', 7000, uid(6)), // retry id sama: tidak ganda
      evt('stuA1', 'NETWORK_LOST', 5000, uid(7)), // bukan "meninggalkan halaman"
      evt('stuA1', 'DEVTOOLS', 5000, uid(8)), // tipe tak dikenal
      evt('stuA3', 'TAB_SWITCH', 5000, uid(9)), // bukan pemilik attempt
      as('stuA1', 'select count(*) from public.ulh_integrity_events'),
      as('teachA', `select count(*) from public.ulh_integrity_events where attempt_id=${K('att')}`),
      as('teachB', 'select count(*) from public.ulh_integrity_events'),
      as('teachA', `select public.ulh_exam_monitor(${K('exam')})`),
      as('teachA', `select jsonb_array_length(public.ulh_attempt_events(${K('att')}))`),
      raw(`select status from public.ulh_attempts where id=${K('att')}`),
      submit(),
      evt('stuA1', 'TAB_SWITCH', 9000, uid(10)), // setelah submit: tidak dicatat
    ]);
    const o = base().length + 1;
    expect(json(r[o])).toMatchObject({ recorded: false, reason: 'below_threshold' });
    expect(json(r[o + 1])).toMatchObject({ recorded: false, reason: 'below_threshold' });
    expect(json(r[o + 2])).toEqual({ recorded: true, warning_level: 1 });
    expect(json(r[o + 3])).toEqual({ recorded: true, warning_level: 2 });
    expect(json(r[o + 4])).toEqual({ recorded: true, warning_level: 3 });
    expect(json(r[o + 5])).toEqual({ recorded: true, warning_level: 3 });
    expect(json(r[o + 6])).toEqual({ recorded: false, warning_level: 3 });
    expect(json(r[o + 7])).toEqual({ recorded: true, warning_level: 0 });
    expect(r[o + 8]).toMatch(STATE('invalid_event_type'));
    expect(r[o + 9]).toMatch(DENY);
    expect(r[o + 10]).toBe('ok:0'); // siswa tak bisa membaca log
    expect(r[o + 11]).toBe('ok:5'); // 4 leave + 1 network
    expect(r[o + 12]).toBe('ok:0');
    const row = json(r[o + 13]).rows.find((x: { student_id: string }) => x.student_id === 'sA1');
    expect(row).toMatchObject({ leave_count: 4, max_warning_level: 3, status: 'active' });
    expect(r[o + 14]).toBe('ok:5');
    expect(r[o + 15]).toBe('ok:active'); // tidak ada sanksi/penghentian otomatis
    expect(json(r[o + 17])).toEqual({ recorded: false, reason: 'not_active' });
  });

  it('menutup ujian menilai attempt aktif; monitor menutup attempt yang kedaluwarsa', () => {
    const r = run([...base(), start(), start('stuA3', 'att3'), answer('stuA1', 'Q1', 'b'), answer('stuA3', 'Q2', 'a', 1, 'att3'),
      raw(`update public.ulh_attempts set started_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id=${K('att3')} returning id`),
      as('teachA', `select (public.ulh_exam_monitor(${K('exam')}))->'rows'`),
      as('teachA', `select public.ulh_close_exam(${K('exam')})`),
      as('teachA', `select public.ulh_close_exam(${K('exam')})`), // idempoten
      raw(`select string_agg(status || ':' || score, ',' order by student_id) from public.ulh_attempts where exam_id=${K('exam')}`),
      as('stuA1', `select public.ulh_save_answer(${K('att')}, ${K('q_Q2')}, ${K('o_Q2_a')}, 3)`),
    ]);
    const o = base().length + 2 + 2;
    const rows = json(r[o + 1]);
    expect(rows.find((x: { student_id: string }) => x.student_id === 'sA3')).toMatchObject({ status: 'expired', correct_count: 1 });
    expect(r[o + 2]).toBe('ok:');
    expect(r[o + 3]).toBe('ok:');
    expect(r[o + 4]).toBe('ok:submitted:33.33,expired:33.33');
    expect(r[o + 5]).toMatch(STATE('attempt_not_active'));
  });

  it('audit trail: tercatat untuk tindakan guru, hanya terbaca OWNER/ADMIN workspace', () => {
    const r = run([...base(), as('teachA', `select public.ulh_close_exam(${K('exam')})`),
      as('ownerA', 'select string_agg(action, \',\' order by id) from public.ulh_audit_log'),
      as('adminA', 'select count(*) from public.ulh_audit_log'),
      as('teachA', 'select count(*) from public.ulh_audit_log'),
      as('ownerB', 'select count(*) from public.ulh_audit_log'),
      as('stuA1', 'select count(*) from public.ulh_audit_log'),
      raw("select count(*) from public.ulh_audit_log where actor_uid <> 'teachA' or workspace_id <> 'wsA'"),
    ]);
    const o = base().length;
    expect(r[o + 1]).toBe('ok:package.create,exam.create,exam.publish,exam.close');
    expect(r[o + 2]).toBe('ok:4');
    expect(r[o + 3]).toBe('ok:0');
    expect(r[o + 4]).toBe('ok:0');
    expect(r[o + 5]).toBe('ok:0');
    expect(r[o + 6]).toBe('ok:0');
  });

  it('peran tertukar & anonim: guru ≠ siswa, anon tanpa akses fungsi', () => {
    const r = run([
      as('stuA1', "select public.ulh_list_packages()"),
      as('stuA1', "select public.ulh_list_exams()"),
      as('teachA', "select public.ulh_list_my_exams()"), // guru tanpa profil siswa
      as('anon', "select public.ulh_list_exams()"),
      as('anon', `select public.ulh_start_attempt(gen_random_uuid())`),
      as('newbie', "select public.ulh_list_exams()"), // guru tanpa workspace
    ]);
    for (const x of r) expect(x).toMatch(DENY);
  });

  it('identitas: klien tidak bisa membaca/menulis proyeksi (tak ada identitas palsu)', () => {
    const forge = "insert into public.ulh_members(user_id, kind, workspace_id, role) values ('stuA1', 'teacher', 'wsA', 'OWNER')";
    const r = run([
      as('stuA1', 'select count(*) from public.ulh_members'),
      as('teachA', 'select count(*) from public.ulh_members'),
      as('ownerA', 'select count(*) from public.ulh_roster'),
      as('stuA1', forge),
      as('stuA1', "update public.ulh_members set kind = 'teacher', role = 'OWNER', student_id = null where user_id = 'stuA1'"),
      as('teachA', "update public.ulh_members set role = 'OWNER' where user_id = 'teachA'"),
      as('teachA', "insert into public.ulh_roster(workspace_id, student_id, class_name) values ('wsA', 'x', '7A')"),
      as('ownerA', 'delete from public.ulh_roster'),
      as('anon', 'select count(*) from public.ulh_members'),
      as('anon', forge),
      // setelah upaya pemalsuan, stuA1 tetap bukan guru
      as('stuA1', 'select public.ulh_list_exams()'),
    ]);
    for (const x of r) expect(x).toMatch(DENY);
  });

  it('identitas: TTL fail-closed; keanggotaan dicabut berlaku seketika; siswa yang sudah mulai tetap bisa menyelesaikan', () => {
    const r = run([...base(), start(),
      raw("update public.ulh_members set synced_at = now() - interval '31 minutes' where user_id = 'teachA' returning user_id"),
      as('teachA', 'select public.ulh_list_exams()'),
      as('teachA', `select public.ulh_exam_monitor(${K('exam')})`),
      as('teachA', 'select count(*) from public.ulh_exams'), // jalur RLS ikut tertutup
      as('teachA', `select public.ulh_save_package(${q(JSON.stringify(pkg()))}::jsonb)`),
      raw("update public.ulh_members set synced_at = now() where user_id = 'teachA' returning user_id"),
      as('teachA', 'select jsonb_array_length(public.ulh_list_exams())'), // segar lagi → pulih
      raw("delete from public.ulh_members where user_id = 'hmA' or user_id = 'adminA' returning user_id"),
      as('adminA', 'select public.ulh_list_exams()'),
      as('adminA', 'select count(*) from public.ulh_audit_log'),
      // siswa: keanggotaan basi → tak bisa daftar/mulai, tapi attempt berjalan tetap bisa dikerjakan & dikumpulkan
      raw("update public.ulh_members set synced_at = now() - interval '7 hours' where user_id = 'stuA1' returning user_id"),
      as('stuA1', 'select public.ulh_list_my_exams()'),
      as('stuA1', `select public.ulh_start_attempt(${K('exam')})`),
      answer('stuA1', 'Q1', 'b'),
      submit(),
      raw("delete from public.ulh_members where user_id = 'stuA3' returning user_id"),
      as('stuA3', `select public.ulh_start_attempt(${K('exam')})`),
    ]);
    const o = base().length + 1;
    expect(r[o + 1]).toMatch(DENY);
    expect(r[o + 2]).toMatch(DENY);
    expect(r[o + 3]).toBe('ok:0');
    expect(r[o + 4]).toMatch(DENY);
    expect(r[o + 6]).toBe('ok:1');
    expect(r[o + 8]).toMatch(DENY);
    expect(r[o + 9]).toBe('ok:0');
    expect(r[o + 11]).toMatch(DENY);
    expect(r[o + 12]).toMatch(DENY);
    expect(r[o + 13]).toBe('ok:true');
    expect(json(r[o + 14]).status).toBe('submitted');
    expect(r[o + 16]).toMatch(DENY);
  });

  it('roster: kelas harus ada di workspace guru; ujian workspace lain tak terlihat siswa workspace ini', () => {
    const wsB = (extra: Record<string, unknown> = {}): Step =>
      as('ownerB', `select public.ulh_save_exam((${q(examJson(extra))}::jsonb) || jsonb_build_object('package_id', (select v from test.kv where k='pkgB')))`, 'examB');
    const r = run([
      savePkg('ownerB', pkg(), 'pkgB'),
      wsB({ class_names: ['7B'] }), // 7B hanya ada di wsA
      wsB({ class_names: ['7A'] }),
      as('ownerB', `select public.ulh_publish_exam(${K('examB')})`),
      as('stuA1', "select jsonb_array_length((public.ulh_list_my_exams())->'exams')"),
      as('stuA1', `select public.ulh_start_attempt(${K('examB')})`),
      as('stuB1', "select jsonb_array_length((public.ulh_list_my_exams())->'exams')"),
    ]);
    expect(r[1]).toMatch(STATE('class_not_found'));
    expect(r[3]).toBe('ok:');
    expect(r[4]).toBe('ok:0');
    expect(r[5]).toMatch(DENY);
    expect(r[6]).toBe('ok:1');
  });

  it('audit grants/definer/search_path/kunci jawaban (katalog)', () => {
    const rows = (sql: string) => psql(url, ['-F', '|', '-c', sql]).split('\n').filter(Boolean).map((l) => l.split('|'));
    const PUB = rows(`select p.proname, p.prosecdef, coalesce(p.proconfig::text,''),
        has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE'),
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0),
        p.prosrc like '%ulh_question_keys%', (p.prosrc like '%ulh_teacher_ctx%' or p.prosrc like '%ulh_student_ctx%' or p.prosrc like '%current_uid%')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ulh\\_%' order by 1`);
    expect(PUB).toHaveLength(17);
    for (const [name, definer, cfg, authExec, anonExec, publicExec, , hasIdentity] of PUB) {
      expect(definer, name).toBe('t');
      expect(cfg, name).toContain('search_path');
      expect(authExec, name).toBe('t');
      expect(anonExec, name).toBe('f');
      expect(publicExec, name).toBe('f');
      expect(hasIdentity, `${name} harus memeriksa identitas`).toBe('t');
    }
    // hanya fungsi guru-pengelola & penilaian yang menyentuh kunci jawaban
    const keyFns = PUB.filter((r) => r[6] === 't').map((r) => r[0]);
    expect(keyFns.sort()).toEqual(['ulh_get_package', 'ulh_save_package']);
    const PRIV = rows(`select p.proname, p.prosecdef, coalesce(p.proconfig::text,''), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        has_function_privilege('anon', p.oid, 'EXECUTE'), exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0),
        p.prosrc like '%ulh_question_keys%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'ulh\\_%' order by 1`);
    const policyHelpers = ['ulh_is_admin_of', 'ulh_manages_attempt', 'ulh_manages_exam', 'ulh_manages_package'];
    for (const [name, definer, cfg, authExec, anonExec, publicExec] of PRIV) {
      expect(definer, name).toBe('t');
      expect(cfg, name).toContain('search_path');
      expect(anonExec, name).toBe('f');
      expect(publicExec, name).toBe('f');
      expect(authExec, name).toBe(policyHelpers.includes(name) ? 't' : 'f');
    }
    expect(PRIV.filter((r) => r[6] === 't').map((r) => r[0])).toEqual(['ulh_finalize']);

    const TBL = rows(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
        has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE')
          or has_table_privilege('authenticated', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'REFERENCES') or has_table_privilege('authenticated', c.oid, 'TRIGGER'),
        has_table_privilege('authenticated', c.oid, 'SELECT'),
        (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and (p.cmd <> 'SELECT' or p.roles <> '{authenticated}'))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ulh\\_%' order by 1`);
    expect(TBL).toHaveLength(13);
    for (const [name, rls, force, anyAnon, authWrite, authSelect, badPolicies] of TBL) {
      expect(rls, name).toBe('t');
      expect(force, name).toBe('f'); // lihat tes "FORCE RLS"
      expect(anyAnon, name).toBe('f');
      expect(authWrite, `${name}: klien tidak boleh punya hak tulis`).toBe('f');
      expect(badPolicies, name).toBe('0');
      expect(authSelect, name).toBe(['ulh_members', 'ulh_roster'].includes(name) ? 'f' : 't');
    }
    expect(psql(url, ['-c', "select count(*) from pg_policies where tablename in ('ulh_members','ulh_roster')"]).trim()).toBe('0');
  });
});

// Mengapa FORCE ROW LEVEL SECURITY dihapus: tanpa BYPASSRLS pada pemilik, RPC SECURITY DEFINER (yang menulis tabel tanpa policy tulis)
// akan ikut diblokir. Di Workflow `postgres` BYPASSRLS=true (terverifikasi read-only), jadi aman dengan atau tanpa FORCE — tetapi tanpa FORCE
// juga benar pada pemilik tanpa BYPASSRLS. Klien tidak pernah terpengaruh karena bukan pemilik.
suite('Ulangan Harian: FORCE RLS vs kepemilikan', () => {
  const attempt = (): Step[] => [...base(), start()];
  for (const [owner, expectOk] of [['nobypass', false], ['bypass', true]] as const) {
    it(`FORCE RLS + pemilik ${owner}: start_attempt ${expectOk ? 'berhasil' : 'GAGAL (bukti FORCE berbahaya tanpa BYPASSRLS)'}`, () => {
      const db = createDatabase(adminUrl as string, true, owner);
      try {
        psql(db.url, [], SETUP);
        psql(db.url, ['-c', 'alter table public.ulh_attempts force row level security'], undefined, { PGOPTIONS: `-c role=sb_owner_${owner}` });
        const r = run(attempt(), db.url);
        const startResult = r[base().length];
        if (expectOk) expect(startResult).toMatch(/^ok:/);
        else expect(startResult).toMatch(/^err:42501:.*row-level security/);
        // tanpa FORCE (kondisi migrasi) pemilik tanpa BYPASSRLS berfungsi
        psql(db.url, ['-c', 'alter table public.ulh_attempts no force row level security'], undefined, { PGOPTIONS: `-c role=sb_owner_${owner}` });
        expect(run(attempt(), db.url)[base().length]).toMatch(/^ok:/);
      } finally { db.drop(); }
    }, 120_000);
  }
});
