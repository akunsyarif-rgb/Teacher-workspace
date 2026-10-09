import type { Case } from './harness';

// Matriks paritas RLS Supabase vs firestore.rules. Tiap kasus menyebut aturan
// Firestore yang diwakili. Tag `[GAP]` = celah yang ditemukan di baseline produksi
// dan ditutup oleh supabase/migrations (gagal bila migrasi tidak dipasang).

const OK1 = /^ok:[1-9]\d*$/; // minimal satu baris
const OK0 = 'ok:0';
const DENY = 'err:42501';
const ANYERR = /^err:/;

const cases: Case[] = [];
const add = (id: string, as: string, steps: string | string[], expect: (string | RegExp) | (string | RegExp)[]) =>
  cases.push({ id, as, steps: [steps].flat(), expect: [expect].flat() });
const addRaw = (id: string, as: string, steps: (string | { raw: string })[], expect: (string | RegExp)[]) =>
  cases.push({ id, as, steps, expect });

const TEACHERS_IN_A = ['ownerA', 'adminA', 'teachA', 'hmA'];
const OUTSIDERS = ['teachB', 'ownerB', 'outsider', 'stuB1'];

// ---------- 1. Baca: isolasi tenant dan akses per peran ----------
const TEACHER_READ = ['academic_years', 'announcements', 'assignments', 'attendances', 'grade_columns', 'grades', 'journals',
  'schedules', 'session_skip_reasons', 'students', 'student_login_codes', 'submissions', 'class_fund_transactions', 'class_inventory'];
const CLASS_VISIBLE_TO_STUDENT = ['announcements', 'assignments', 'attendances', 'grade_columns', 'schedules']; // rules: isStudentInClass
const OWN_VISIBLE_TO_STUDENT = ['grades', 'submissions']; // rules: isOwnStudentData
for (const t of TEACHER_READ) {
  for (const u of TEACHERS_IN_A) add(`read:${t}:${u}`, u, `select * from public.${t} where workspace_id='wsA'`, OK1);
  for (const u of OUTSIDERS) add(`read:${t}:${u}:isolasi`, u, `select * from public.${t} where workspace_id='wsA'`, OK0);
  const studentRows = CLASS_VISIBLE_TO_STUDENT.includes(t) || OWN_VISIBLE_TO_STUDENT.includes(t) ? 'ok:1' : OK0;
  add(`read:${t}:stuA1`, 'stuA1', `select * from public.${t} where workspace_id='wsA'`, studentRows);
  add(`read:${t}:stuA2`, 'stuA2', `select * from public.${t} where workspace_id='wsA'`, studentRows);
}
// student_notes / student_achievements: wali kelas atau admin/owner; siswa hanya prestasi miliknya.
for (const t of ['student_notes', 'student_achievements']) {
  for (const u of ['ownerA', 'adminA']) add(`read:${t}:${u}`, u, `select * from public.${t}`, 'ok:2');
  add(`read:${t}:hmA`, 'hmA', `select * from public.${t}`, 'ok:1'); // hanya kelas 7A
  add(`read:${t}:teachA`, 'teachA', `select * from public.${t}`, OK0);
  for (const u of OUTSIDERS) add(`read:${t}:${u}`, u, `select * from public.${t}`, OK0);
  add(`read:${t}:stuA1`, 'stuA1', `select * from public.${t}`, t === 'student_achievements' ? 'ok:1' : OK0);
}
add('read:payments:ownerA', 'ownerA', 'select * from public.payments', 'ok:1');
for (const u of ['adminA', 'teachA', 'teachB', 'stuA1']) add(`read:payments:${u}`, u, 'select * from public.payments', OK0);
for (const u of TEACHERS_IN_A) add(`read:workspaces:${u}`, u, "select * from public.workspaces where id='wsA'", 'ok:1');
for (const u of ['teachB', 'outsider', 'stuA1']) add(`read:workspaces:${u}:isolasi`, u, "select * from public.workspaces where id='wsA'", OK0);
add('read:workspace_invites:ownerA', 'ownerA', "select * from public.workspace_invites where workspace_id='wsA'", 'ok:2');
for (const u of ['adminA', 'teachA', 'outsider']) add(`read:workspace_invites:${u}`, u, "select * from public.workspace_invites where workspace_id='wsA'", OK0);
for (const u of ['ownerA', 'adminA']) add(`read:teacher_profiles:${u}`, u, "select * from public.teacher_profiles where workspace_id='wsA'", 'ok:4');
for (const u of ['teachA', 'hmA']) add(`read:teacher_profiles:${u}:hanya-diri`, u, "select * from public.teacher_profiles where workspace_id='wsA'", 'ok:1');
for (const u of ['teachB', 'outsider', 'stuA1']) add(`read:teacher_profiles:${u}`, u, "select * from public.teacher_profiles where workspace_id='wsA'", OK0);
add('read:student_profiles:stuA1', 'stuA1', 'select * from public.student_profiles', 'ok:1');
add('read:student_profiles:teachA', 'teachA', 'select * from public.student_profiles', OK0);

// ---------- 2. Tulis: guru di workspace ----------
const ins = (t: string, ws: string): string => {
  const id = `new_${t}`;
  const m: Record<string, string> = {
    academic_years: `insert into public.academic_years(id, workspace_id, label) values ('${id}','${ws}','x')`,
    announcements: `insert into public.announcements(id, workspace_id, class_name, title) values ('${id}','${ws}','7A','x')`,
    assignments: `insert into public.assignments(id, workspace_id, class_name, title) values ('${id}','${ws}','7A','x')`,
    attendances: `insert into public.attendances(id, workspace_id, class_name, status) values ('${id}','${ws}','7A','hadir')`,
    grade_columns: `insert into public.grade_columns(id, workspace_id, class_name, name) values ('${id}','${ws}','7A','x')`,
    grades: `insert into public.grades(id, workspace_id, class_name, student_id, column_id) values ('${id}','${ws}','7A','sA2','gcA7A')`,
    journals: `insert into public.journals(id, workspace_id, class_name) values ('${id}','${ws}','7A')`,
    schedules: `insert into public.schedules(id, workspace_id, class_name) values ('${id}','${ws}','7A')`,
    session_skip_reasons: `insert into public.session_skip_reasons(id, workspace_id, class_name) values ('${id}','${ws}','7A')`,
    students: `insert into public.students(id, workspace_id, class_name) values ('${id}','${ws}','7A')`,
    student_login_codes: `insert into public.student_login_codes(id, workspace_id, student_id, class_name, code) values ('${id}','${ws}','sA1','7A','${id}')`,
    submissions: `insert into public.submissions(id, workspace_id, assignment_id, student_id, status) values ('${id}','${ws}','aA7A','sA2','menunggu_penilaian')`,
  };
  return m[t];
};
const TEACHER_WRITE = ['academic_years', 'announcements', 'assignments', 'attendances', 'grade_columns', 'grades', 'journals',
  'schedules', 'session_skip_reasons', 'students', 'student_login_codes', 'submissions'];
for (const t of TEACHER_WRITE) {
  for (const u of TEACHERS_IN_A) add(`write:${t}:insert:${u}`, u, ins(t, 'wsA'), 'ok:1');
  add(`write:${t}:insert-lintas-workspace:teachB`, 'teachB', ins(t, 'wsA'), DENY);
  add(`write:${t}:insert-lintas-workspace:teachA-ke-wsB`, 'teachA', ins(t, 'wsB'), DENY);
  if (t !== 'submissions') add(`write:${t}:insert:stuA1`, 'stuA1', ins(t, 'wsA'), DENY);
  add(`write:${t}:update:teachA`, 'teachA', `update public.${t} set metadata='{"k":1}'::jsonb where workspace_id='wsA'`, OK1);
  add(`write:${t}:update:teachB`, 'teachB', `update public.${t} set metadata='{"k":1}'::jsonb where workspace_id='wsA'`, OK0);
  add(`write:${t}:update:stuA1`, 'stuA1', `update public.${t} set metadata='{"k":1}'::jsonb where workspace_id='wsA'`, t === 'submissions' ? /^(ok:[01]|err:42501)$/ : OK0);
  add(`write:${t}:pindah-workspace:teachA`, 'teachA', `update public.${t} set workspace_id='wsB' where workspace_id='wsA'`, DENY);
  add(`write:${t}:delete:teachA`, 'teachA', `delete from public.${t} where workspace_id='wsA'`, OK1);
  add(`write:${t}:delete:teachB`, 'teachB', `delete from public.${t} where workspace_id='wsA'`, OK0);
  add(`write:${t}:delete:stuA1`, 'stuA1', `delete from public.${t} where workspace_id='wsA'`, OK0);
}

// ---------- 3. Tulis: hanya wali kelas (kas, inventaris, catatan, prestasi) ----------
const hmIns = (t: string, cls: string): string => {
  const id = `new_${t}_${cls}`;
  const m: Record<string, string> = {
    class_fund_transactions: `insert into public.class_fund_transactions(id, workspace_id, class_name, amount) values ('${id}','wsA','${cls}',1)`,
    class_inventory: `insert into public.class_inventory(id, workspace_id, class_name, name) values ('${id}','wsA','${cls}','x')`,
    student_notes: `insert into public.student_notes(id, workspace_id, class_name, student_id, note) values ('${id}','wsA','${cls}','sA1','x')`,
    student_achievements: `insert into public.student_achievements(id, workspace_id, class_name, student_id, title) values ('${id}','wsA','${cls}','sA1','x')`,
  };
  return m[t];
};
for (const t of ['class_fund_transactions', 'class_inventory', 'student_notes', 'student_achievements']) {
  add(`hm:${t}:insert:hmA-kelasnya`, 'hmA', hmIns(t, '7A'), 'ok:1');
  add(`hm:${t}:insert:hmA-kelas-lain`, 'hmA', hmIns(t, '7B'), DENY);
  for (const u of ['teachA', 'ownerA', 'adminA', 'stuA1']) add(`hm:${t}:insert:${u}`, u, hmIns(t, '7A'), DENY);
  add(`hm:${t}:update:hmA`, 'hmA', `update public.${t} set metadata='{"k":1}'::jsonb where class_name='7A'`, OK1);
  add(`hm:${t}:update:hmA-kelas-lain`, 'hmA', `update public.${t} set metadata='{"k":1}'::jsonb where class_name='7B'`, OK0);
  for (const u of ['teachA', 'ownerA']) add(`hm:${t}:update:${u}`, u, `update public.${t} set metadata='{"k":1}'::jsonb where class_name='7A'`, OK0);
  add(`hm:${t}:delete:hmA`, 'hmA', `delete from public.${t} where class_name='7A'`, OK1);
  for (const u of ['teachA', 'ownerA']) add(`hm:${t}:delete:${u}`, u, `delete from public.${t} where class_name='7A'`, OK0);
}

// ---------- 4. Pembayaran: tanpa tulis dari klien ----------
add('payments:insert:ownerA', 'ownerA', "insert into public.payments(order_id, workspace_id, status) values ('o2','wsA','settlement')", DENY);
add('payments:update:ownerA', 'ownerA', "update public.payments set status='settlement'", DENY);

// ---------- 5. Workspace ----------
add('workspaces:update-nama:ownerA', 'ownerA', "update public.workspaces set name='Baru' where id='wsA'", 'ok:1');
for (const col of ["plan='individual_monthly'", 'class_limit=999', 'seat_limit=999', 'plan_expires_at=1']) {
  add(`workspaces:kunci-field:${col}`, 'ownerA', `update public.workspaces set ${col} where id='wsA'`, DENY);
}
add('workspaces:transfer-owner', 'ownerA', "update public.workspaces set owner_uid='teachA' where id='wsA'", DENY);
add('workspaces:update:teachA', 'teachA', "update public.workspaces set name='x' where id='wsA'", OK0);
add('workspaces:update:teachB', 'teachB', "update public.workspaces set name='x' where id='wsA'", OK0);
add('workspaces:delete:ownerA', 'ownerA', "delete from public.workspaces where id='wsA'", OK0);
const wsIns = (uid: string, plan: string, cl: string, sl: string) =>
  `insert into public.workspaces(id, owner_uid, plan, class_limit, seat_limit) values ('wsNew','${uid}','${plan}',${cl},${sl})`;
add('workspaces:insert:individual-gratis', 'newOwner', wsIns('newOwner', 'individual_lifetime', '3', 'null'), 'ok:1');
add('workspaces:insert:sekolah-batas-gratis', 'newOwner', wsIns('newOwner', 'school_annual', '3', '1'), 'ok:1');
add('workspaces:insert:owner-orang-lain', 'newOwner', wsIns('ownerA', 'individual_lifetime', '3', 'null'), DENY);
add('workspaces:insert:[GAP] sekolah-tanpa-batas-gratis', 'newOwner', wsIns('newOwner', 'school_annual', 'null', 'null'), DENY);
add('workspaces:insert:[GAP] kursi-guru-besar', 'newOwner', wsIns('newOwner', 'school_annual', '3', '500'), DENY);
add('workspaces:insert:[GAP] kelas-banyak', 'newOwner', wsIns('newOwner', 'individual_lifetime', '500', 'null'), DENY);
add('workspaces:insert:[GAP] plan-bulanan-tanpa-bayar', 'newOwner', wsIns('newOwner', 'individual_monthly', 'null', 'null'), DENY);

// ---------- 6. Undangan ----------
add('invites:insert:ownerA', 'ownerA', "insert into public.workspace_invites(code, workspace_id) values ('NEWA','wsA')", 'ok:1');
add('invites:insert-ke-wsB:ownerA', 'ownerA', "insert into public.workspace_invites(code, workspace_id) values ('NEWB','wsB')", DENY);
add('invites:insert:teachA', 'teachA', "insert into public.workspace_invites(code, workspace_id) values ('NEWA','wsA')", DENY);
add('invites:delete:ownerA', 'ownerA', "delete from public.workspace_invites where workspace_id='wsA'", OK1);
add('invites:delete:teachA', 'teachA', "delete from public.workspace_invites where workspace_id='wsA'", OK0);
add('rpc:lookup:kode-aktif', 'outsider', "select * from public.lookup_workspace_invite('INVITA')", 'ok:1');
add('rpc:lookup:kode-ngawur', 'outsider', "select * from public.lookup_workspace_invite('NOPE')", OK0);
add('rpc:lookup:[GAP] kode-lama-tidak-boleh-bocorkan-kode-aktif', 'outsider', "select * from public.lookup_workspace_invite('OLDA')", OK0);
add('rpc:lookup:anon-ditolak', 'anon', "select * from public.lookup_workspace_invite('INVITA')", DENY);

// ---------- 7. Profil guru ----------
add('tp:update-nama:teachA', 'teachA', "update public.teacher_profiles set name='x' where user_id='teachA'", 'ok:1');
add('tp:update-profil-orang-lain', 'teachA', "update public.teacher_profiles set name='x' where user_id='hmA'", OK0);
add('tp:naik-role:teachA', 'teachA', "update public.teacher_profiles set role='OWNER' where user_id='teachA'", DENY);
add('tp:pindah-workspace:teachA', 'teachA', "update public.teacher_profiles set workspace_id='wsB' where user_id='teachA'", DENY);
add('tp:jadi-wali:teachA', 'teachA', "update public.teacher_profiles set homeroom_class_name='7B' where user_id='teachA'", DENY);
add('tp:lepas-wali:hmA', 'hmA', "update public.teacher_profiles set homeroom_class_name=null where user_id='hmA'", DENY);
add('tp:set-wali:ownerA', 'ownerA', "update public.teacher_profiles set homeroom_class_name='7C' where user_id='ownerA'", 'ok:1');
add('tp:delete:teachA', 'teachA', "delete from public.teacher_profiles where user_id='teachA'", OK0);
const tpIns = (uid: string, role: string | null, ws: string | null, hr = 'null') =>
  `insert into public.teacher_profiles(user_id, role, workspace_id, homeroom_class_name) values ('${uid}',${role ? `'${role}'` : 'null'},${ws ? `'${ws}'` : 'null'},${hr})`;
add('tp:insert:kosong', 'fresh', tpIns('fresh', null, null), 'ok:1');
add('tp:insert:orang-lain', 'fresh', tpIns('lain', null, null), DENY);
add('tp:insert:owner-workspace-sendiri', 'ownerX', tpIns('ownerX', 'OWNER', 'wsX'), 'ok:1');
add('tp:insert:owner-workspace-orang', 'fresh', tpIns('fresh', 'OWNER', 'wsA'), DENY);
add('tp:insert:admin-tidak-bisa-klaim', 'fresh', tpIns('fresh', 'ADMIN', 'wsA'), DENY);
add('tp:insert:wali-saat-daftar', 'ownerX', tpIns('ownerX', 'OWNER', 'wsX', "'7A'"), DENY);
add('tp:[GAP] klaim-TEACHER-tanpa-kode-lewat-insert', 'outsider', tpIns('outsider', 'TEACHER', 'wsA'), DENY);
add('tp:[GAP] klaim-TEACHER-tanpa-kode-lewat-update', 'newbie', "update public.teacher_profiles set workspace_id='wsA', role='TEACHER' where user_id='newbie'", DENY);
add('tp:[GAP] klaim-TEACHER-lewati-batas-kursi', 'outsider', tpIns('outsider', 'TEACHER', 'wsS'), DENY);

// RPC gabung workspace lewat kode (pengganti klaim mandiri)
const profileOf = (uid: string) => `select coalesce(workspace_id,'-')||'/'||coalesce(role,'-') from public.teacher_profiles where user_id='${uid}'`;
addRaw('rpc:join:kode-benar', 'outsider', ["select public.join_workspace_by_code('INVITA')", { raw: profileOf('outsider') }], ['ok:1', 'wsA/TEACHER']);
addRaw('rpc:join:profil-kosong-ikut-terisi', 'newbie', ["select public.join_workspace_by_code('INVITA')", { raw: profileOf('newbie') }], ['ok:1', 'wsA/TEACHER']);
add('rpc:join:kode-lama', 'outsider', "select public.join_workspace_by_code('OLDA')", ANYERR);
add('rpc:join:kode-ngawur', 'outsider', "select public.join_workspace_by_code('NOPE')", ANYERR);
add('rpc:join:kode-kedaluwarsa', 'outsider', "select public.join_workspace_by_code('INVX')", ANYERR);
add('rpc:join:kursi-penuh', 'outsider', "select public.join_workspace_by_code('INVS')", ANYERR);
add('rpc:join:sudah-punya-workspace', 'teachB', "select public.join_workspace_by_code('INVITA')", ANYERR);
add('rpc:join:anon-ditolak', 'anon', "select public.join_workspace_by_code('INVITA')", DENY);

// ---------- 8. Siswa: klaim profil dan pengumpulan ----------
const claim = (code: string) => `select * from public.claim_student_login_code('${code}')`;
add('rpc:claim-lookup:kode-benar', 'stuNew', claim('CODEA1'), 'ok:1');
add('rpc:claim-lookup:kode-ngawur', 'stuNew', claim('NOPE'), OK0);
add('rpc:claim-lookup:anon-ditolak', 'anon', claim('CODEA1'), DENY);
add('sp:[GAP] buat-profil-siswa-palsu', 'stuNew', "insert into public.student_profiles(user_id, workspace_id, student_id, class_name) values ('stuNew','wsA','sA1','7A')", DENY);
const spOf = (uid: string) => `select workspace_id||'/'||student_id||'/'||class_name from public.student_profiles where user_id='${uid}'`;
addRaw('rpc:claim-profil:kode-benar', 'stuNew', ["select * from public.claim_student_profile('CODEA1')", { raw: spOf('stuNew') }], ['ok:1', 'wsA/sA1/7A']);
addRaw('rpc:claim-profil:lalu-baca-tugas-kelasnya', 'stuNew', ["select * from public.claim_student_profile('CODEA1')", 'select * from public.assignments'], ['ok:1', 'ok:1']);
addRaw('rpc:claim-profil:idempoten', 'stuNew', ["select * from public.claim_student_profile('CODEA1')", "select * from public.claim_student_profile('CODEA1')"], ['ok:1', 'ok:1']);
addRaw('rpc:claim-profil:identitas-terkunci', 'stuA1', ["select * from public.claim_student_profile('CODEA2')", { raw: spOf('stuA1') }], [/^(ok:\d+|err:.*)$/, 'wsA/sA1/7A']);
add('rpc:claim-profil:kode-ngawur', 'stuNew', "select * from public.claim_student_profile('NOPE')", ANYERR);
add('rpc:claim-profil:anon-ditolak', 'anon', "select * from public.claim_student_profile('CODEA1')", DENY);
add('sp:update-ditolak', 'stuA1', "update public.student_profiles set class_name='7B' where user_id='stuA1'", DENY); // hak UPDATE dicabut
add('sp:delete-ditolak', 'stuA1', "delete from public.student_profiles where user_id='stuA1'", DENY); // hak DELETE dicabut

add('sub:siswa-insert-sendiri', 'stuA1', "insert into public.submissions(id, workspace_id, assignment_id, student_id, status) values ('sNew','wsA','aA7B','sA1','menunggu_penilaian')", 'ok:1');
add('sub:siswa-insert-status-dinilai', 'stuA1', "insert into public.submissions(id, workspace_id, assignment_id, student_id, status) values ('sNew','wsA','aA7B','sA1','dinilai')", DENY);
add('sub:siswa-insert-feedback', 'stuA1', "insert into public.submissions(id, workspace_id, assignment_id, student_id, status, feedback) values ('sNew','wsA','aA7B','sA1','menunggu_penilaian','x')", DENY);
add('sub:siswa-insert-atas-nama-orang', 'stuA1', "insert into public.submissions(id, workspace_id, assignment_id, student_id, status) values ('sNew','wsA','aA7A','sA2','menunggu_penilaian')", DENY);
add('sub:[GAP] siswa-insert-dengan-nilai', 'stuA1', "insert into public.submissions(id, workspace_id, assignment_id, student_id, status, score) values ('sNew','wsA','aA7B','sA1','menunggu_penilaian',100)", DENY);
add('sub:siswa-link-drive-valid', 'stuA1', `insert into public.submissions(id, workspace_id, assignment_id, student_id, status, external_link) values ('sNew','wsA','aA7B','sA1','menunggu_penilaian','{"provider":"google-drive","url":"https://drive.google.com/x"}')`, 'ok:1');
add('sub:siswa-link-bukan-drive', 'stuA1', `insert into public.submissions(id, workspace_id, assignment_id, student_id, status, external_link) values ('sNew','wsA','aA7B','sA1','menunggu_penilaian','{"provider":"google-drive","url":"https://evil.example/x"}')`, DENY);
addRaw('sub:siswa-update-tak-bisa-ubah-nilai-catatan', 'stuA1',
  ["update public.submissions set text_answer='baru', feedback='hack', score=100 where id='aA7A_sA1'", { raw: "select coalesce(feedback,'<null>')||'/'||coalesce(score::text,'<null>')||'/'||text_answer from public.submissions where id='aA7A_sA1'" }],
  ['ok:1', '<null>/<null>/baru']);
add('sub:siswa-ganti-id-siswa', 'stuA1', "update public.submissions set student_id='sA2' where id='aA7A_sA1'", DENY);
add('sub:siswa-terkunci-setelah-dinilai', 'stuA2', "update public.submissions set text_answer='ubah' where id='aA7B_sA2'", DENY);
add('sub:siswa-balik-status-setelah-dinilai', 'stuA2', "update public.submissions set status='menunggu_penilaian', text_answer='ubah' where id='aA7B_sA2'", DENY);
add('sub:siswa-lain-tak-bisa-ubah', 'stuB1', "update public.submissions set text_answer='x' where id='aA7A_sA1'", OK0);
addRaw('sub:guru-memberi-nilai', 'teachA',
  ["update public.submissions set status='dinilai', score=95, feedback='ok' where id='aA7A_sA1'", { raw: "select score::text||'/'||feedback from public.submissions where id='aA7A_sA1'" }],
  ['ok:1', '95.000/ok']);

export default cases;
