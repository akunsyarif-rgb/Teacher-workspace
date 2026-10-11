import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, psql, type OwnerMode } from './ulangan/harness';
import { SETUP } from './ulangan/fixtures';

// Uji RPC/RLS Ulangan Harian di Postgres LOKAL (BUKAN Supabase nyata). RPC dipanggil sebagai service_role (satu-satunya yang boleh),
// klien (authenticated/anon) dipastikan tidak punya jalan. Tiap skenario = satu transaksi yang di-rollback.
//   RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-db.test.ts
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

type Role = 'svc' | 'authenticated' | 'anon';
type Step = { as: Role; sql: string; save?: string } | { raw: string; save?: string };
const svc = (sql: string, save?: string): Step => ({ as: 'svc', sql, save });
const asRole = (as: Role, sql: string): Step => ({ as, sql });
const raw = (sql: string, save?: string): Step => ({ raw: sql, save });
const K = (k: string) => `(select v from test.kv where k='${k}')::uuid`;
const j = (s: string) => `$j$${s}$j$`; // tag dalam; pembungkus run() memakai $q$
const outer = (s: string) => `$q$${s}$q$`;

let url = '';
let drop = () => {};

function run(steps: Step[], target: string = url): string[] {
  const out: string[] = ['begin;'];
  steps.forEach((s, i) => {
    const save = s.save ? `'${s.save}'` : 'null';
    if ('raw' in s) {
      out.push('reset role;', s.raw.startsWith('!') ? `select '${i}|' || test.exec(${outer(s.raw.slice(1))});` : `select '${i}|' || test.call(${outer(s.raw)}, ${save});`);
    } else {
      const role = s.as === 'svc' ? 'service_role' : s.as;
      out.push('reset role;', `set local role ${role};`, `select '${i}|' || test.call(${outer(s.sql)}, ${save});`);
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
const INVALID = /^err:22023/;

// ---------- Aktor (yang di produksi diturunkan route server dari token + Firestore) ----------
const TA = "'wsA', 'tA', false"; // guru biasa wsA
const TX = "'wsA', 'tX', false"; // guru lain wsA
const ADM = "'wsA', 'adm', true"; // OWNER/ADMIN wsA
const TB = "'wsB', 'tB', false";
const S1 = "'wsA', 'uS1', 'sA1', '7A'"; // ws, uid, studentId, class
const S2 = "'wsA', 'uS2', 'sA2', '7B'";
const S3 = "'wsA', 'uS3', 'sA3', '7A'";
const B1 = "'wsB', 'uB1', 'sB1', '7A'";

const examBody = (extra: Record<string, unknown> = {}) => ({
  title: 'UH 1', subject: 'IPA', duration_minutes: 30, class_names: ['7A'], shuffle: true, show_result: true,
  opens_at: '2000-01-01T00:00:00Z', closes_at: '2999-01-01T00:00:00Z',
  questions: [
    { body: 'Q1', options: ['a', 'b', 'c', 'd'], correct_index: 1 },
    { body: 'Q2', options: ['a', 'b', 'c', 'd'], correct_index: 0 },
    { body: 'Q3', options: ['a', 'b', 'c', 'd'], correct_index: 2 },
  ],
  ...extra,
});
const saveExam = (who = TA, extra: Record<string, unknown> = {}, save = 'exam'): Step =>
  svc(`select public.ulh_save_exam(${who}, ${j(JSON.stringify(examBody(extra)))}::jsonb)`, save);
const publish = (who = TA): Step => svc(`select public.ulh_publish_exam(${who}, ${K('exam')})`);
const lookups = (): Step[] => {
  const s: Step[] = [];
  for (const n of ['Q1', 'Q2', 'Q3']) {
    s.push(raw(`select q.id from public.ulh_questions q where q.body='${n}' and q.exam_id=${K('exam')}`, `q_${n}`));
    for (const l of ['a', 'b', 'c', 'd'])
      s.push(raw(`select o.id from public.ulh_options o join public.ulh_questions q on q.id=o.question_id where q.body='${n}' and q.exam_id=${K('exam')} and o.label='${l}'`, `o_${n}_${l}`));
  }
  return s;
};
const NLOOK = 15;
const base = (): Step[] => [saveExam(), publish(), ...lookups()]; // 2 + 15 = 17 langkah
const BASE = 2 + NLOOK;
const start = (who = S1, save = 'att'): Step => svc(`select (public.ulh_start_attempt(${who}, ${K('exam')}))->>'id'`, save);
const answer = (uid: string, qn: string, l: string, seq = 1, att = 'att'): Step =>
  svc(`select public.ulh_save_answer('${uid}', ${K(att)}, ${K('q_' + qn)}, ${K(`o_${qn}_${l}`)}, ${seq})`);
const submit = (uid = 'uS1', att = 'att'): Step => svc(`select public.ulh_submit_attempt('${uid}', ${K(att)})`);
const evt = (uid: string, type: string, ms: number | null, id: string, att = 'att'): Step =>
  svc(`select public.ulh_report_integrity_event('${uid}', ${K(att)}, '${id}'::uuid, '${type}', now(), ${ms ?? 'null'}, '{}')`);
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const MODES: { name: string; owner: OwnerMode }[] = [
  { name: 'superuser', owner: undefined },
  { name: 'pemilik NOSUPERUSER BYPASSRLS (setara postgres Supabase)', owner: 'bypass' },
  { name: 'pemilik NOSUPERUSER NOBYPASSRLS (kasus terburuk)', owner: 'nobypass' },
];

for (const mode of MODES) suite(`Ulangan Harian [${mode.name}]`, () => {
  beforeAll(() => {
    const db = createDatabase(adminUrl as string, mode.owner);
    url = db.url;
    drop = db.drop;
    psql(url, [], SETUP);
  }, 120_000);
  afterAll(() => drop());

  it('guru membuat ulangan lengkap (soal+kelas+jadwal); workspace & pembuat dari aktor, bukan payload', () => {
    const r = run([
      saveExam(TA, { workspace_id: 'wsB', created_by: 'tB' }),
      raw(`select workspace_id || '/' || created_by from public.ulh_exams where id=${K('exam')}`),
      svc(`select jsonb_array_length(public.ulh_list_exams(${TA}))`),
      svc(`select jsonb_array_length(public.ulh_list_exams(${TX}))`), // guru lain: tidak melihat milik tA
      svc(`select jsonb_array_length(public.ulh_list_exams(${ADM}))`), // admin melihat semua di workspace
      svc(`select jsonb_array_length(public.ulh_list_exams(${TB}))`),
      svc(`select jsonb_array_length((public.ulh_get_exam(${TA}, ${K('exam')}))->'questions')`),
      svc(`select ((public.ulh_get_exam(${TA}, ${K('exam')}))->'questions'->0->>'correct_index')`),
      svc(`select (public.ulh_get_exam(${ADM}, ${K('exam')}))->>'title'`),
      svc(`select public.ulh_get_exam(${TX}, ${K('exam')})`),
      svc(`select public.ulh_get_exam(${TB}, ${K('exam')})`),
    ]);
    expect(r[1]).toBe('ok:wsA/tA');
    expect(r.slice(2, 6)).toEqual(['ok:1', 'ok:0', 'ok:1', 'ok:0']);
    expect(r[6]).toBe('ok:3');
    expect(r[7]).toBe('ok:1');
    expect(r[8]).toBe('ok:UH 1');
    expect(r[9]).toMatch(DENY);
    expect(r[10]).toMatch(DENY);
  });

  it('validasi input guru ditegakkan di database', () => {
    const q = (o: Record<string, unknown>) => ({ body: 'Q', options: ['a', 'b'], correct_index: 0, ...o });
    const bad: Record<string, unknown>[] = [
      { questions: [] }, { questions: [q({ options: ['a'] })] }, { questions: [q({ correct_index: 2 })] }, { questions: [q({ options: ['a', ' '] })] },
      { questions: [q({ points: 0 })] }, { questions: Array.from({ length: 101 }, () => q({})) }, { class_names: [] }, { duration_minutes: 0 },
      { duration_minutes: 301 }, { title: '  ' }, { closes_at: '1999-01-01T00:00:00Z' }, { opens_at: null },
    ];
    const r = run(bad.map((b, i) => saveExam(TA, b, `bad${i}`)));
    r.forEach((x, i) => expect(x, `kasus ${i}`).toMatch(INVALID));
    expect(run([svc(`select public.ulh_save_exam('', 'tA', false, ${j(JSON.stringify(examBody()))}::jsonb)`), svc(`select public.ulh_save_exam('wsA', '', false, ${j(JSON.stringify(examBody()))}::jsonb)`),
      svc(`select public.ulh_list_exams(' ', 'tA', false)`), svc("select public.ulh_get_attempt('', gen_random_uuid())")]).every((x) => INVALID.test(x))).toBe(true);
  });

  it('daur hidup: draft bisa diedit/dihapus; terbit terkunci; tutup menilai yang berjalan; jadwal lampau ditolak', () => {
    const r = run([
      saveExam(), ...lookups(),
      svc(`select public.ulh_save_exam(${TA}, ${j(JSON.stringify(examBody({ title: 'Diubah' })))}::jsonb || jsonb_build_object('id', ${K('exam')}::text))`), // draft: boleh
      svc(`select public.ulh_save_exam(${TX}, ${j(JSON.stringify(examBody()))}::jsonb || jsonb_build_object('id', ${K('exam')}::text))`), // bukan pembuat
      svc(`select public.ulh_save_exam(${TB}, ${j(JSON.stringify(examBody()))}::jsonb || jsonb_build_object('id', ${K('exam')}::text))`), // workspace lain
      publish(TX), publish(TB),
      publish(), publish(), // idempoten
      svc(`select public.ulh_save_exam(${TA}, ${j(JSON.stringify(examBody()))}::jsonb || jsonb_build_object('id', ${K('exam')}::text))`),
      svc(`select public.ulh_delete_exam(${TA}, ${K('exam')})`),
      start(S1), svc(`select public.ulh_close_exam(${TX}, ${K('exam')})`),
      svc(`select public.ulh_close_exam(${TA}, ${K('exam')})`), svc(`select public.ulh_close_exam(${TA}, ${K('exam')})`),
      raw(`select status || '|' || coalesce(score::text, '-') from public.ulh_attempts where id=${K('att')}`),
    ]);
    const o = 1 + NLOOK;
    expect(r[o]).toMatch(/^ok:/);
    expect(r[o + 1]).toMatch(DENY);
    expect(r[o + 2]).toMatch(DENY);
    expect(r[o + 3]).toMatch(DENY);
    expect(r[o + 4]).toMatch(DENY);
    expect(r[o + 5]).toBe('ok:');
    expect(r[o + 6]).toBe('ok:');
    expect(r[o + 7]).toMatch(STATE('exam_locked'));
    expect(r[o + 8]).toMatch(STATE('exam_locked'));
    expect(r[o + 10]).toMatch(DENY);
    expect(r[o + 11]).toBe('ok:');
    expect(r[o + 12]).toBe('ok:');
    expect(r[o + 13]).toBe('ok:submitted|0.00'); // ditutup guru: attempt berjalan dinilai (tanpa jawaban = 0)
    // jadwal tutup sudah lewat → tak bisa terbit; draft bisa dihapus pembuatnya saja
    const r2 = run([saveExam(TA, { opens_at: '2000-01-01T00:00:00Z', closes_at: '2001-01-01T00:00:00Z' }), publish(), svc(`select public.ulh_delete_exam(${TX}, ${K('exam')})`),
      svc(`select public.ulh_delete_exam(${TA}, ${K('exam')})`), raw('select count(*) from public.ulh_exams')]);
    expect(r2[1]).toMatch(STATE('schedule_in_past'));
    expect(r2[2]).toMatch(DENY);
    expect(r2[4]).toBe('ok:0');
  });

  it('siswa hanya melihat/mengerjakan ulangan terbit untuk kelas & workspace-nya', () => {
    const r = run([saveExam(), ...lookups(),
      svc(`select jsonb_array_length((public.ulh_list_student_exams('wsA', 'sA1', '7A'))->'exams')`), // draft: tak terlihat
      start(S1, 'draftAtt'),
      publish(),
      svc(`select jsonb_array_length((public.ulh_list_student_exams('wsA', 'sA1', '7A'))->'exams')`),
      svc(`select jsonb_array_length((public.ulh_list_student_exams('wsA', 'sA2', '7B'))->'exams')`), // kelas lain
      svc(`select jsonb_array_length((public.ulh_list_student_exams('wsB', 'sB1', '7A'))->'exams')`), // 7A di workspace lain
      svc(`select public.ulh_start_attempt(${S2}, ${K('exam')})`),
      svc(`select public.ulh_start_attempt(${B1}, ${K('exam')})`),
      svc(`select public.ulh_start_attempt('wsA', 'x', 'sA1', '7B', ${K('exam')})`), // mengaku kelas lain
      start(S1),
    ]);
    const o = 1 + NLOOK;
    expect(r[o]).toBe('ok:0');
    expect(r[o + 1]).toMatch(DENY);
    expect(r[o + 3]).toBe('ok:1');
    expect(r[o + 4]).toBe('ok:0');
    expect(r[o + 5]).toBe('ok:0');
    for (const i of [6, 7, 8]) expect(r[o + i]).toMatch(DENY);
    expect(r[o + 9]).toMatch(/^ok:/);
  });

  it('kunci jawaban tidak bocor: payload siswa tanpa kunci; tabel tak terbaca siapa pun lewat SQL klien/service', () => {
    const tables = ['ulh_question_keys', 'ulh_questions', 'ulh_options', 'ulh_exams', 'ulh_attempts', 'ulh_answers', 'ulh_integrity_events', 'ulh_exam_classes'];
    const r = run([...base(), start(),
      ...tables.flatMap((t) => [asRole('authenticated', `select count(*) from public.${t}`), asRole('anon', `select count(*) from public.${t}`), svc(`select count(*) from public.${t}`)]),
      svc(`select public.ulh_get_attempt('uS1', ${K('att')})`),
    ]);
    const o = BASE + 1;
    for (let i = 0; i < tables.length * 3; i++) expect(r[o + i], `akses tabel ${i}`).toMatch(DENY);
    const att = json(r[o + tables.length * 3]);
    expect(att.questions).toHaveLength(3);
    for (const q of att.questions) {
      expect(Object.keys(q).sort()).toEqual(['body', 'id', 'options', 'points', 'position']);
      expect(q.options).toHaveLength(4);
      for (const op of q.options) expect(Object.keys(op).sort()).toEqual(['id', 'label']);
    }
    expect(JSON.stringify(att)).not.toMatch(/correct|key/i);
    expect(att.attempt.result).toBeNull();
  });

  it('klien (authenticated/anon) tidak dapat memanggil RPC apa pun', () => {
    const calls = [
      `public.ulh_list_exams(${TA})`, `public.ulh_get_attempt('uS1', gen_random_uuid())`, `public.ulh_start_attempt(${S1}, gen_random_uuid())`,
      `public.ulh_list_student_exams('wsA', 'sA1', '7A')`, `public.ulh_submit_attempt('uS1', gen_random_uuid())`,
      `public.ulh_save_answer('uS1', gen_random_uuid(), gen_random_uuid(), null, 1)`,
      `public.ulh_report_integrity_event('uS1', gen_random_uuid(), gen_random_uuid(), 'TAB_SWITCH')`,
      `public.ulh_exam_results(${TA}, gen_random_uuid())`, `private.ulh_finalize(gen_random_uuid(), 'submitted')`, `private.ulh_need('a')`,
    ];
    const r = run(calls.flatMap((c) => [asRole('authenticated', `select ${c}`), asRole('anon', `select ${c}`)]));
    for (const x of r) expect(x).toMatch(DENY);
  });

  it('penilaian server-side & submit idempoten; skor tidak datang dari klien; hasil disembunyikan bila show_result=false', () => {
    const r = run([...base(), start(), answer('uS1', 'Q1', 'b'), answer('uS1', 'Q2', 'd'), submit(), submit(), answer('uS1', 'Q3', 'c', 5),
      raw(`select status || '|' || score || '|' || max_score || '|' || correct_count from public.ulh_attempts where id=${K('att')}`),
      svc(`select public.ulh_list_student_exams('wsA', 'sA1', '7A')->'exams'->0->'attempt'->'result'`),
    ]);
    const o = BASE;
    const s1 = json(r[o + 3]); const s2 = json(r[o + 4]);
    expect(s1.status).toBe('submitted');
    expect(s1.result).toEqual({ score: 33.33, max_score: 3, correct_count: 1 });
    expect({ ...s2, server_now: 0 }).toEqual({ ...s1, server_now: 0 });
    expect(r[o + 5]).toMatch(STATE('attempt_not_active'));
    expect(r[o + 6]).toBe('ok:submitted|33.33|3|1');
    expect(json(r[o + 7])).toEqual({ score: 33.33, max_score: 3, correct_count: 1 });
    const hidden = run([saveExam(TA, { show_result: false }), publish(), ...lookups(), start(), answer('uS1', 'Q1', 'b'), submit(),
      svc(`select public.ulh_list_student_exams('wsA', 'sA1', '7A')->'exams'->0->'attempt'->'result'`)]);
    expect(json(hidden[2 + NLOOK + 2]).result).toBeNull();
    expect(hidden[2 + NLOOK + 3]).toBe('ok:null');
  });

  it('timer server: dibatasi durasi & penutupan; jawaban sesudah batas ditolak; submit sesudah batas = expired dengan jawaban lama', () => {
    const r = run([saveExam(TA, { duration_minutes: 30, closes_at: new Date(Date.now() + 10 * 60_000).toISOString() }), publish(), ...lookups(),
      start(),
      raw(`select extract(epoch from expires_at - started_at)::int from public.ulh_attempts where id=${K('att')}`),
      answer('uS1', 'Q1', 'b', 1),
      raw(`update public.ulh_attempts set started_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id=${K('att')} returning id`),
      answer('uS1', 'Q2', 'a', 2),
      submit(),
      svc(`select public.ulh_get_attempt('uS1', ${K('att')})`),
      raw(`select status || '|' || correct_count || '|' || max_score from public.ulh_attempts where id=${K('att')}`),
    ]);
    const o = BASE;
    const dur = Number(r[o + 1].replace('ok:', ''));
    expect(dur).toBeLessThanOrEqual(600);
    expect(dur).toBeGreaterThan(540 - 5);
    expect(r[o + 2]).toBe('ok:true');
    expect(r[o + 4]).toMatch(STATE('attempt_expired'));
    expect(json(r[o + 5]).status).toBe('expired');
    expect(json(r[o + 6]).questions).toEqual([]);
    expect(r[o + 7]).toBe('ok:expired|1|3');
  });

  it('jendela ujian: belum dibuka/sudah ditutup ditolak; start idempoten; sesi baru siswa yang sama mengambil alih pengerjaan aktif', () => {
    const w = run([saveExam(TA, { opens_at: '2999-01-01T00:00:00Z', closes_at: '2999-02-01T00:00:00Z' }), publish(), start(S1, 'x')]);
    expect(w[2]).toMatch(STATE('exam_not_open'));
    const c = run([saveExam(), publish(), svc(`select public.ulh_close_exam(${TA}, ${K('exam')})`), start(S1, 'x')]);
    expect(c[3]).toMatch(STATE('exam_not_open'));
    const r = run([...base(), start(S1, 'att'), start(S1, 'att2'),
      raw(`select count(*) from public.ulh_attempts where exam_id=${K('exam')}`),
      raw(`select (v = (select v from test.kv where k='att2'))::text from test.kv where k='att'`),
      answer('uS1', 'Q1', 'b'),
      svc(`select (public.ulh_start_attempt('wsA', 'uS1baru', 'sA1', '7A', ${K('exam')}))->>'id'`, 'att3'), // login ulang dari perangkat baru (uid anonim baru)
      svc(`select public.ulh_get_attempt('uS1', ${K('att')})`), // sesi lama kehilangan akses
      svc(`select jsonb_array_length((public.ulh_get_attempt('uS1baru', ${K('att')}))->'questions')`),
      svc(`select (public.ulh_get_attempt('uS1baru', ${K('att')}))->'answers'->>(select v from test.kv where k='q_Q1')`),
      svc(`select public.ulh_submit_attempt('uS1baru', ${K('att')})`),
      svc(`select (public.ulh_start_attempt('wsA', 'uS1lagi', 'sA1', '7A', ${K('exam')}))->>'status'`), // sudah submit: tidak dialihkan
      svc(`select public.ulh_get_attempt('uS1lagi', ${K('att')})`),
    ]);
    const o = BASE + 2;
    expect(r[o]).toBe('ok:1');
    expect(r[o + 1]).toBe('ok:true'); // start kedua = attempt yang sama
    expect(r[o + 2]).toBe('ok:true'); // jawaban tersimpan
    expect(r[o + 3]).toMatch(/^ok:[0-9a-f-]{36}$/); // start dari sesi baru → attempt yang sama, kini milik uid baru
    expect(r[o + 4]).toMatch(DENY); // sesi lama kehilangan akses
    expect(r[o + 5]).toBe('ok:3');
    expect(r[o + 6]).toMatch(/^ok:[0-9a-f-]{36}$/); // jawaban Q1 terbawa
    expect(json(r[o + 7]).status).toBe('submitted');
    expect(r[o + 8]).toBe('ok:submitted');
    expect(r[o + 9]).toMatch(DENY);
  });

  it('autosave: idempoten, monoton, validasi soal/opsi, hanya pemilik; null menghapus', () => {
    const r = run([...base(), start(), answer('uS1', 'Q1', 'b', 2), answer('uS1', 'Q1', 'b', 2), answer('uS1', 'Q1', 'c', 1), answer('uS1', 'Q1', 'd', 3),
      raw(`select option_id = ${K('o_Q1_d')} from public.ulh_answers where attempt_id=${K('att')} and question_id=${K('q_Q1')}`),
      raw(`select count(*) from public.ulh_answers where attempt_id=${K('att')}`),
      svc(`select public.ulh_save_answer('uS1', ${K('att')}, ${K('q_Q1')}, ${K('o_Q2_a')}, 4)`), // opsi soal lain
      svc(`select public.ulh_save_answer('uS1', ${K('att')}, gen_random_uuid(), ${K('o_Q1_a')}, 4)`), // soal tak ada
      answer('uS3', 'Q1', 'a', 9), answer('uB1', 'Q1', 'a', 9), // bukan pemilik
      svc(`select public.ulh_save_answer('uS1', ${K('att')}, ${K('q_Q1')}, null, 5)`),
      raw(`select count(*) from public.ulh_answers where attempt_id=${K('att')}`),
    ]);
    const o = BASE + 1;
    expect(r.slice(o, o + 4)).toEqual(['ok:true', 'ok:true', 'ok:false', 'ok:true']);
    expect(r[o + 4]).toBe('ok:true');
    expect(r[o + 5]).toBe('ok:1');
    expect(r[o + 6]).toMatch(STATE('option_not_for_question'));
    expect(r[o + 7]).toMatch(STATE('question_not_in_attempt'));
    expect(r[o + 8]).toMatch(DENY);
    expect(r[o + 9]).toMatch(DENY);
    expect(r[o + 10]).toBe('ok:true');
    expect(r[o + 11]).toBe('ok:0');
    // soal dari ulangan LAIN tidak boleh dijawab pada attempt ini
    const x = run([...base(), svc(`select public.ulh_save_exam(${TA}, ${j(JSON.stringify(examBody({ title: 'Lain' })))}::jsonb)`, 'exam2'), start(),
      raw(`select q.id from public.ulh_questions q where q.exam_id=${K('exam2')} limit 1`, 'qOther'),
      raw(`select o.id from public.ulh_options o where o.question_id=${K('qOther')} limit 1`, 'oOther'),
      svc(`select public.ulh_save_answer('uS1', ${K('att')}, ${K('qOther')}, ${K('oOther')}, 1)`)]);
    expect(x[BASE + 4]).toMatch(STATE('question_not_in_attempt'));
  });

  it('acak stabil per attempt (hash), tanpa tabel blueprint; shuffle=false mengikuti urutan guru; semua soal/opsi ada', () => {
    const r = run([...base(), start(),
      svc(`select (public.ulh_get_attempt('uS1', ${K('att')}))->'questions'`, 'g1'),
      svc(`select (public.ulh_get_attempt('uS1', ${K('att')}))->'questions'`, 'g2'),
      raw("select (select v from test.kv where k='g1') = (select v from test.kv where k='g2')")]);
    const o = BASE + 1;
    expect(r[o + 2]).toBe('ok:true');
    const qs = json(r[o]);
    expect(qs.map((x: { body: string }) => x.body).sort()).toEqual(['Q1', 'Q2', 'Q3']);
    expect(qs.map((x: { position: number }) => x.position)).toEqual([1, 2, 3]);
    expect(qs.every((x: { options: unknown[] }) => x.options.length === 4)).toBe(true);
    const ordered = run([saveExam(TA, { shuffle: false }), publish(), ...lookups(), start(), svc(`select (public.ulh_get_attempt('uS1', ${K('att')}))->'questions'`)]);
    const q2 = json(ordered[2 + NLOOK + 1]);
    expect(q2.map((x: { body: string }) => x.body)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(q2[0].options.map((o: { label: string }) => o.label)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('integritas: ambang >3 dtk, tingkat 1/2/3, idempoten, tanpa sanksi otomatis, hanya pemilik, tak dicatat setelah submit', () => {
    const r = run([...base(), start(),
      evt('uS1', 'TAB_SWITCH', 2000, uid(1)), evt('uS1', 'TAB_SWITCH', 3000, uid(2)), evt('uS1', 'TAB_SWITCH', 4000, uid(3)),
      evt('uS1', 'WINDOW_BLUR', 5000, uid(4)), evt('uS1', 'VISIBILITY_LOST', 6000, uid(5)), evt('uS1', 'TAB_SWITCH', 7000, uid(6)), evt('uS1', 'TAB_SWITCH', 7000, uid(6)),
      evt('uS1', 'NETWORK_LOST', 5000, uid(7)), evt('uS1', 'DEVTOOLS', 5000, uid(8)), evt('uS3', 'TAB_SWITCH', 5000, uid(9)),
      raw(`select status from public.ulh_attempts where id=${K('att')}`),
      submit(), evt('uS1', 'TAB_SWITCH', 9000, uid(10)),
    ]);
    const o = BASE + 1;
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
    expect(r[o + 10]).toBe('ok:active');
    expect(json(r[o + 12])).toEqual({ recorded: false, reason: 'not_active' });
  });

  it('hasil guru: status per siswa, skor, sinyal integritas; admin/pembuat saja; yang kedaluwarsa dinilai; kelas berubah tidak menghilangkan hasil', () => {
    const r = run([...base(), start(S1, 'att'), start(S3, 'att3'), answer('uS1', 'Q1', 'b'), answer('uS3', 'Q2', 'a', 1, 'att3'), evt('uS1', 'TAB_SWITCH', 5000, uid(1)),
      raw(`update public.ulh_attempts set started_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id=${K('att3')} returning id`),
      svc(`select public.ulh_exam_results(${TA}, ${K('exam')})`),
      svc(`select public.ulh_exam_results(${ADM}, ${K('exam')})->'attempts'->0->>'status'`),
      svc(`select public.ulh_exam_results(${TX}, ${K('exam')})`), svc(`select public.ulh_exam_results(${TB}, ${K('exam')})`),
      svc(`select public.ulh_attempt_events(${TA}, ${K('att')})`), svc(`select public.ulh_attempt_events(${TX}, ${K('att')})`), svc(`select public.ulh_attempt_events(${TB}, ${K('att')})`),
      svc(`select public.ulh_exam_results(${TA}, ${K('exam')})->'exam'->'class_names'`),
    ]);
    const o = BASE + 6;
    const res = json(r[o]);
    expect(res.exam).toMatchObject({ title: 'UH 1', question_count: 3, class_names: ['7A'] });
    const a3 = res.attempts.find((a: { student_id: string }) => a.student_id === 'sA3');
    expect(a3).toMatchObject({ status: 'expired', correct_count: 1, answered_count: 1 });
    const a1 = res.attempts.find((a: { student_id: string }) => a.student_id === 'sA1');
    expect(a1).toMatchObject({ status: 'active', answered_count: 1, leave_count: 1, max_warning_level: 1 });
    expect(r[o + 1]).toMatch(/^ok:/);
    expect(r[o + 2]).toMatch(DENY);
    expect(r[o + 3]).toMatch(DENY);
    expect(json(r[o + 4])).toHaveLength(1);
    expect(r[o + 5]).toMatch(DENY);
    expect(r[o + 6]).toMatch(DENY);
    expect(json(r[o + 7])).toEqual(['7A']);
  });

  it('katalog: 14 RPC definer + search_path kosong, EXECUTE hanya service_role; tabel tanpa grant/policy; kunci hanya di fungsi yang berhak', () => {
    const rows = (sql: string) => psql(url, ['-F', '|', '-c', sql]).split('\n').filter(Boolean).map((l) => l.split('|'));
    const PUB = rows(`select p.proname, p.prosecdef, coalesce(p.proconfig::text,''),
        has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE'),
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0),
        p.prosrc like '%ulh_question_keys%', p.prosrc like '%private.ulh_need%'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ulh\\_%' order by 1`);
    expect(PUB).toHaveLength(14);
    for (const [name, definer, cfg, svcExec, authExec, anonExec, publicExec, , needsActor] of PUB) {
      expect(definer, name).toBe('t');
      expect(cfg, name).toContain('search_path');
      expect([svcExec, authExec, anonExec, publicExec], name).toEqual(['t', 'f', 'f', 'f']);
      expect(needsActor, `${name} harus memvalidasi aktor`).toBe('t');
    }
    expect(PUB.filter((r) => r[7] === 't').map((r) => r[0])).toEqual(['ulh_get_exam', 'ulh_save_exam']);
    const PRIV = rows(`select p.proname, p.prosecdef, has_function_privilege('service_role', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        has_function_privilege('anon', p.oid, 'EXECUTE'), p.prosrc like '%ulh_question_keys%', coalesce(p.proconfig::text, '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'ulh\\_%' order by 1`);
    for (const [name, , svcExec, authExec, anonExec, , cfg] of PRIV) {
      expect([svcExec, authExec, anonExec], name).toEqual(['f', 'f', 'f']);
      expect(cfg, name).toContain('search_path');
    }
    expect(PRIV.filter((r) => r[5] === 't').map((r) => r[0])).toEqual(['ulh_finalize']);
    const TBL = rows(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        (select count(*) from (values ('anon'), ('authenticated'), ('service_role')) r(role)
           where has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as granted
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ulh\\_%' order by 1`);
    expect(TBL.map((r) => r[0])).toEqual(['ulh_answers', 'ulh_attempts', 'ulh_exam_classes', 'ulh_exams', 'ulh_integrity_events', 'ulh_options', 'ulh_question_keys', 'ulh_questions']);
    for (const [name, rls, force, granted] of TBL) {
      expect(rls, name).toBe('t');
      expect(force, name).toBe('f'); // lihat tes "FORCE RLS vs kepemilikan"
      expect(granted, `${name}: tanpa hak tabel untuk siapa pun kecuali pemilik`).toBe('0');
    }
    expect(psql(url, ['-c', "select count(*) from pg_policies where tablename like 'ulh\\_%'"]).trim()).toBe('0');
  });
});

// Mengapa FORCE ROW LEVEL SECURITY tidak dipakai: tanpa BYPASSRLS pada pemilik, RPC SECURITY DEFINER yang menulis tabel tanpa policy
// akan diblokir. Di Workflow `postgres` BYPASSRLS=true (terverifikasi read-only), jadi aman dengan atau tanpa FORCE — dan tanpa FORCE
// juga benar pada pemilik tanpa BYPASSRLS.
suite('Ulangan Harian: FORCE RLS vs kepemilikan', () => {
  for (const [owner, expectOk] of [['nobypass', false], ['bypass', true]] as const) {
    it(`FORCE RLS + pemilik ${owner}: start_attempt ${expectOk ? 'berhasil' : 'GAGAL (bukti FORCE berbahaya tanpa BYPASSRLS)'}`, () => {
      const db = createDatabase(adminUrl as string, owner);
      try {
        psql(db.url, [], SETUP);
        const steps = [...base(), start()];
        psql(db.url, ['-c', 'alter table public.ulh_attempts force row level security'], undefined, { PGOPTIONS: `-c role=sb_owner_${owner}` });
        const r = run(steps, db.url)[BASE];
        if (expectOk) expect(r).toMatch(/^ok:/);
        else expect(r).toMatch(/^err:42501:.*row-level security/);
        psql(db.url, ['-c', 'alter table public.ulh_attempts no force row level security'], undefined, { PGOPTIONS: `-c role=sb_owner_${owner}` });
        expect(run(steps, db.url)[BASE]).toMatch(/^ok:/);
      } finally { db.drop(); }
    }, 120_000);
  }
});
