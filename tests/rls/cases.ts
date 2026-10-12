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

// ---------- 9. Klaim berbentuk token Firebase ASLI (bukan hanya {sub, role}) ----------
// Token Firebase membawa iss/aud/user_id/firebase{...}; RLS hanya boleh memakai `sub`.
const fbClaims = (uid: string, provider: 'password' | 'anonymous', extra: Record<string, unknown> = {}) => ({
  iss: 'https://securetoken.google.com/proj', aud: 'proj', auth_time: 1760000000, user_id: uid, sub: uid,
  iat: 1760000000, exp: 4102444800, firebase: { identities: provider === 'anonymous' ? {} : { email: [`${uid}@x.id`] }, sign_in_provider: provider },
  role: 'authenticated', ...extra,
});
const addFb = (id: string, claims: Record<string, unknown>, steps: string | string[], expect: (string | RegExp) | (string | RegExp)[]) =>
  cases.push({ id, as: String(claims.sub ?? 'x'), claims, steps: [steps].flat(), expect: [expect].flat() });

addFb('fb:guru-baca-skip-reasons-workspace-sendiri', fbClaims('ownerA', 'password'), "select * from public.session_skip_reasons where workspace_id='wsA'", OK1);
addFb('fb:guru-lain-tenant-tidak-melihat', fbClaims('ownerB', 'password'), "select * from public.session_skip_reasons where workspace_id='wsA'", OK0);
addFb('fb:guru-insert-skip-reason-sendiri', fbClaims('teachA', 'password'), "insert into public.session_skip_reasons(id, workspace_id, class_name, date, reason, metadata) values ('skFb','wsA','7A',current_date,'rapat','{\"scheduleId\":\"s\"}')", 'ok:1');
addFb('fb:guru-insert-skip-reason-tenant-lain', fbClaims('teachA', 'password'), "insert into public.session_skip_reasons(id, workspace_id) values ('skFb','wsB')", DENY);
addFb('fb:siswa-anonim-baca-tugas-kelasnya', fbClaims('stuA1', 'anonymous'), "select * from public.assignments", 'ok:1');
addFb('fb:siswa-anonim-tak-bisa-baca-catatan', fbClaims('stuA1', 'anonymous'), "select * from public.student_notes", OK0);
addFb('fb:siswa-anonim-tak-bisa-baca-skip-reasons', fbClaims('stuA1', 'anonymous'), "select * from public.session_skip_reasons", OK0);
addFb('fb:siswa-anonim-tanpa-profil-tidak-melihat-apa-pun', fbClaims('anonNew', 'anonymous'), "select * from public.assignments", OK0);
addFb('fb:user_id-dipalsukan-sub-yang-dipakai', fbClaims('outsider', 'password', { user_id: 'ownerA' }), "select * from public.session_skip_reasons where workspace_id='wsA'", OK0);
addFb('fb:sub-kosong-tidak-punya-identitas', fbClaims('', 'password', { user_id: 'ownerA' }), "select * from public.teacher_profiles", OK0);

// ---------- 10. batch_write (RPC transaksional, SECURITY INVOKER) ----------
const bw = (ops: string) => `select public.batch_write('${ops.replace(/'/g, "''")}'::jsonb)`;
const rowOf = (t: string, id: string, ws: string, extra = '') => `{"op":"set","table":"${t}","row":{"id":"${id}","workspace_id":"${ws}"${extra}}}`;
add('bw:guru-set-baru-dan-hapus-atomik', 'teachA', bw(`[${rowOf('students', 'bwS1', 'wsA', ',"class_name":"7A","name":"Baru"')},${rowOf('students', 'bwS2', 'wsA', ',"class_name":"7A","name":"Baru2"')},{"op":"delete","table":"students","id":"sA2"}]`), 'ok:1');
addRaw('bw:set-merge-metadata-dan-kolom', 'teachA',
  [bw(`[${rowOf('students', 'sA1', 'wsA', ',"name":"Diganti","metadata":{"k":1}')}]`), { raw: "select name||'/'||(metadata->>'k')||'/'||class_name from public.students where id='sA1'" }],
  ['ok:1', 'Diganti/1/7A']);
add('bw:tenant-lain-ditolak-RLS', 'teachA', bw(`[${rowOf('students', 'bwX', 'wsB', ',"class_name":"7A"')}]`), DENY);
addRaw('bw:gagal-di-tengah-membatalkan-semua', 'teachA',
  [`select public.batch_write('[${rowOf('students', 'bwAtom', 'wsA', ',"class_name":"7A"').replace(/'/g, "''")},${rowOf('students', 'bwX2', 'wsB', ',"class_name":"7A"').replace(/'/g, "''")}]'::jsonb)`, { raw: "select count(*) from public.students where id='bwAtom'" }],
  [DENY, '0']);
add('bw:timpa-baris-tenant-lain-via-id-ditolak', 'teachA', bw(`[${rowOf('students', 'sB1', 'wsA', ',"class_name":"7A","name":"Curian"')}]`), ANYERR);
addRaw('bw:hapus-baris-tenant-lain-tak-berefek', 'teachA',
  [bw('[{"op":"delete","table":"students","id":"sB1"}]'), { raw: "select count(*) from public.students where id='sB1'" }], ['ok:1', '1']);
add('bw:tabel-terlarang', 'ownerA', bw('[{"op":"delete","table":"workspaces","id":"wsA"}]'), ANYERR);
add('bw:tabel-payments-terlarang', 'ownerA', bw(`[${rowOf('payments', 'x', 'wsA')}]`), ANYERR);
add('bw:kolom-tidak-dikenal', 'teachA', bw(`[${rowOf('students', 'bwC', 'wsA', ',"class_name":"7A","bukan_kolom":1')}]`), ANYERR);
add('bw:tanpa-workspace_id', 'teachA', bw('[{"op":"set","table":"students","row":{"id":"bwN","class_name":"7A"}}]'), ANYERR);
add('bw:op-tak-dikenal', 'teachA', bw('[{"op":"drop","table":"students","id":"x"}]'), ANYERR);
add('bw:bukan-array', 'teachA', bw('{"op":"delete"}'), ANYERR);
add('bw:lebih-dari-500', 'teachA', `select public.batch_write((select jsonb_agg('{"op":"delete","table":"students","id":"z"}'::jsonb) from generate_series(1,501)))`, ANYERR);
add('bw:siswa-tidak-bisa-menulis', 'stuA1', bw(`[${rowOf('students', 'bwSt', 'wsA', ',"class_name":"7A"')}]`), DENY);
add('bw:anon-ditolak', 'anon', bw('[]'), DENY);
add('bw:orang-luar-tidak-bisa-menulis', 'outsider', bw(`[${rowOf('students', 'bwOut', 'wsA', ',"class_name":"7A"')}]`), DENY);
addRaw('bw:wali-kelas-sesuai-RLS-kas-kelas', 'hmA',
  [bw(`[${rowOf('class_fund_transactions', 'bwCF', 'wsA', ',"class_name":"7A","amount":5000,"type":"masuk"')}]`), bw(`[${rowOf('class_fund_transactions', 'bwCF2', 'wsA', ',"class_name":"7B","amount":5000,"type":"masuk"')}]`)],
  ['ok:1', DENY]);
addRaw('bw:set-tanpa-metadata-tidak-menghapus-metadata-lama', 'teachA',
  [bw(`[${rowOf('students', 'sA1', 'wsA', ',"metadata":{"a":1}')}]`), bw(`[${rowOf('students', 'sA1', 'wsA', ',"name":"X"')}]`), { raw: "select metadata->>'a' from public.students where id='sA1'" }],
  ['ok:1', 'ok:1', '1']);

const fbUid = (u: string) => u; // alias keterbacaan
// ---------- 11. Jalur siswa & unit students/student_login_codes lewat batch_write ----------
const subRow = (id: string, extra: string) => `{"op":"set","table":"submissions","row":{"id":"${id}","workspace_id":"wsA","class_name":"7A","assignment_id":"aA7A","student_id":"sA1"${extra}}}`;
addRaw('bw11:siswa-kumpul-tugas-lain-insert-lalu-update', 'stuA1',
  [bw(`[{"op":"set","table":"submissions","row":{"id":"aA7B_sA1","workspace_id":"wsA","class_name":"7B","assignment_id":"aA7B","student_id":"sA1","status":"menunggu_penilaian","text_answer":"v1"}}]`),
   bw(`[{"op":"set","table":"submissions","row":{"id":"aA7B_sA1","workspace_id":"wsA","class_name":"7B","assignment_id":"aA7B","student_id":"sA1","status":"menunggu_penilaian","text_answer":"v2"}}]`),
   { raw: "select text_answer from public.submissions where id='aA7B_sA1'" }],
  ['ok:1', 'ok:1', 'v2']);
// Skor dari siswa diabaikan trigger guard (sama seperti update langsung: ok tetapi nilai tidak berubah); insert baru dengan skor ditolak.
addRaw('bw11:siswa-menyisipkan-nilai-pada-update-diabaikan', 'stuA1',
  [bw(`[${subRow('aA7A_sA1', ',"status":"menunggu_penilaian","score":100,"feedback":"hack"')}]`), { raw: "select coalesce(score::text,'<null>')||'/'||coalesce(feedback,'<null>') from public.submissions where id='aA7A_sA1'" }],
  ['ok:1', '<null>/<null>']);
add('bw11:siswa-insert-baru-dengan-nilai-ditolak', 'stuA1', bw(`[{"op":"set","table":"submissions","row":{"id":"aA7B_sA1","workspace_id":"wsA","class_name":"7B","assignment_id":"aA7B","student_id":"sA1","status":"menunggu_penilaian","score":100}}]`), DENY);
add('bw11:siswa-tidak-bisa-kumpul-atas-nama-orang-lain', 'stuA1', bw(`[{"op":"set","table":"submissions","row":{"id":"aA7B_sA2","workspace_id":"wsA","assignment_id":"aA7B","student_id":"sA2","status":"menunggu_penilaian"}}]`), ANYERR);
addRaw('bw11:siswa-delete-tak-berefek', 'stuA1', [bw('[{"op":"delete","table":"submissions","id":"aA7A_sA1"}]'), { raw: "select count(*) from public.submissions where id='aA7A_sA1'" }], ['ok:1', '1']);
add('bw11:siswa-tidak-bisa-menulis-grades', 'stuA1', bw(`[{"op":"set","table":"grades","row":{"id":"sA1_gcA7A","workspace_id":"wsA","class_name":"7A","student_id":"sA1","column_id":"gcA7A","score":100}}]`), DENY);
// unit siswa: guru membuat siswa + kode dalam satu transaksi (pola createStudent), kode langsung bisa diklaim siswa baru
addRaw('bw11:unit-guru-buat-siswa-dan-kode-atomik-lalu-diklaim', 'teachA',
  [bw(`[{"op":"set","table":"students","row":{"id":"stNew","workspace_id":"wsA","class_name":"7A","name":"Baru","nis":"9","access_code":"NEWCODE"}},{"op":"set","table":"student_login_codes","row":{"id":"NEWCODE","code":"NEWCODE","workspace_id":"wsA","student_id":"stNew","class_name":"7A","name":"Baru","nis":"9"}}]`),
   { raw: "select (select count(*) from public.students where id='stNew')||'/'||(select count(*) from public.student_login_codes where id='NEWCODE')" }],
  ['ok:1', '1/1']);
addRaw('bw11:unit-gagal-di-tengah-tidak-meninggalkan-kode-yatim', 'teachA',
  [`select public.batch_write('[{"op":"set","table":"students","row":{"id":"stOrph","workspace_id":"wsA","class_name":"7A","name":"X"}},{"op":"set","table":"student_login_codes","row":{"id":"ORPH","code":"ORPH","workspace_id":"wsB","student_id":"stOrph","class_name":"7A"}}]'::jsonb)`,
   { raw: "select (select count(*) from public.students where id='stOrph')||'/'||(select count(*) from public.student_login_codes where id='ORPH')" }],
  [DENY, '0/0']);
addRaw('bw11:unit-hapus-siswa-dan-kode-atomik', 'teachA',
  [bw('[{"op":"delete","table":"students","id":"sA1"},{"op":"delete","table":"student_login_codes","id":"CODEA1"}]'),
   { raw: "select (select count(*) from public.students where id='sA1')||'/'||(select count(*) from public.student_login_codes where id='CODEA1')" }],
  ['ok:1', '0/0']);
addRaw('bw11:siswa-baru-klaim-kode-yang-dibuat-guru', 'stuNew',
  [`select * from public.claim_student_profile('CODEA1')`, { raw: "select student_id||'/'||class_name from public.student_profiles where user_id='stuNew'" }],
  ['ok:1', 'sA1/7A']);
add('bw11:siswa-tidak-bisa-batch-ke-student_profiles', 'stuA1', bw(`[{"op":"set","table":"student_profiles","row":{"id":"x","workspace_id":"wsA"}}]`), ANYERR);
add('bw11:guru-tidak-bisa-batch-ke-student_profiles', 'teachA', bw(`[{"op":"set","table":"student_profiles","row":{"id":"x","workspace_id":"wsA"}}]`), ANYERR);
// Fixture memakai student_profiles.user_id sebagai kunci; query by user_id untuk profil sendiri (jalur getStudentProfile)
add('bw11:siswa-membaca-profil-sendiri-by-user_id', fbUid('stuA1'), "select * from public.student_profiles where user_id='stuA1'", 'ok:1');
add('bw11:siswa-tak-bisa-membaca-profil-orang-lain', 'stuA1', "select * from public.student_profiles where user_id='stuA2'", OK0);
// Range query seperti Arsip/Cleanup: tanggal & timestamp
add('rng:guru-journals-rentang-tanggal', 'teachA', "select * from public.journals where workspace_id='wsA' and date >= current_date - 1 and date <= current_date + 1", 'ok:1');
add('rng:guru-journals-rentang-di-luar', 'teachA', "select * from public.journals where workspace_id='wsA' and date >= current_date + 5", OK0);
add('rng:tenant-lain-tak-melihat-rentang', 'teachB', "select * from public.journals where workspace_id='wsA' and date >= current_date - 1", OK0);
add('rng:submissions-rentang-submitted_at', 'teachA', "select * from public.submissions where workspace_id='wsA' and submitted_at <= now() + interval '1 day'", 'ok:2');

// ---------- 12. Menu Admin sekolah: remove_workspace_member (tanpa kaitan pembayaran) ----------
const mem = (uid: string) => `select coalesce(workspace_id,'-')||'/'||coalesce(role,'-')||'/'||coalesce(homeroom_class_name,'-') from public.teacher_profiles where user_id='${uid}'`;
addRaw('adm:owner-keluarkan-guru-bersih', 'ownerA',
  ["select public.remove_workspace_member('hmA')", { raw: mem('hmA') }], ['ok:1', '-/-/-']);
add('adm:guru-biasa-tak-bisa-keluarkan', 'teachA', "select public.remove_workspace_member('hmA')", DENY);
add('adm:admin-bukan-owner-tak-bisa', 'adminA', "select public.remove_workspace_member('hmA')", DENY);
add('adm:owner-tenant-lain-tak-bisa', 'ownerB', "select public.remove_workspace_member('hmA')", DENY);
add('adm:tidak-bisa-keluarkan-diri-sendiri', 'ownerA', "select public.remove_workspace_member('ownerA')", ANYERR);
add('adm:tidak-ada-target', 'ownerA', "select public.remove_workspace_member('tidak-ada')", ANYERR);
add('adm:target-kosong', 'ownerA', "select public.remove_workspace_member('')", ANYERR);
add('adm:anon-ditolak', 'anon', "select public.remove_workspace_member('hmA')", DENY);
addRaw('adm:tidak-menghapus-data-yang-dibuat-guru', 'ownerA',
  ["select public.remove_workspace_member('teachA')", { raw: "select count(*) from public.journals where teacher_uid='teachA'" }], ['ok:1', '1']);
// ---------- 13. Alur identitas sekolah dari KLIEN (tanpa pembayaran): buat workspace → klaim OWNER → kode undangan ----------
addRaw('id:guru-baru-buat-workspace-sekolah-lalu-klaim-OWNER', 'newbie',
  ["insert into public.workspaces(id, owner_uid, name, plan, class_limit, seat_limit, invite_code, invite_code_expires_at) values ('wsN','newbie','SMA Baru','school_annual',3,1,'NEW234',(extract(epoch from now() + interval '7 days') * 1000)::bigint)",
   "update public.teacher_profiles set workspace_id='wsN', role='OWNER' where user_id='newbie'",
   { raw: "select coalesce(workspace_id,'-')||'/'||coalesce(role,'-') from public.teacher_profiles where user_id='newbie'" }],
  ['ok:1', 'ok:1', 'wsN/OWNER']);
addRaw('id:profil-baru-boleh-dibuat-tanpa-workspace', 'brandNew',
  ["insert into public.teacher_profiles(user_id, name, metadata) values ('brandNew','Bu Baru','{\"subject\":\"IPA\"}')", { raw: "select name||'/'||(metadata->>'subject') from public.teacher_profiles where user_id='brandNew'" }],
  ['ok:1', 'Bu Baru/IPA']);
add('id:owner-ganti-kode-undangan', 'ownerA', "update public.workspaces set invite_code='ZZZ999', invite_code_expires_at=(extract(epoch from now() + interval '7 days') * 1000)::bigint where id='wsA'", 'ok:1');
add('id:guru-biasa-tak-bisa-ganti-kode-undangan', 'teachA', "update public.workspaces set invite_code='HACK12' where id='wsA'", OK0);
add('id:owner-tak-bisa-mengubah-batas-kuota-sendiri', 'ownerA', "update public.workspaces set seat_limit=9999, class_limit=null where id='wsA'", DENY);
add('id:guru-simpan-catatan-cepat-dan-mapel', 'teachA', "update public.teacher_profiles set metadata = metadata || '{\"quickNote\":\"n\",\"subject\":\"IPA\"}'::jsonb where user_id='teachA'", 'ok:1');
add('id:anggota-membaca-workspace-sendiri', 'teachA', "select * from public.workspaces where id='wsA'", 'ok:1');
add('id:orang-luar-tak-melihat-workspace', 'teachB', "select * from public.workspaces where id='wsA'", OK0);
add('id:siswa-tak-melihat-workspace', 'stuA1', "select * from public.workspaces where id='wsA'", OK0);
addRaw('id:gabung-kode-lalu-baca-data-workspace', 'newbie',
  ["select * from public.join_workspace_by_code('INVITA')", "select * from public.students where workspace_id='wsA'"], ['ok:1', 'ok:2']);
export default cases;
