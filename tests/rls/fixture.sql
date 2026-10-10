-- Data uji RLS (hanya lokal, dijalankan sebagai superuser sehingga RLS dilewati).
-- Tenant A (wsA): sekolah aktif dengan 2 kelas (7A, 7B). Tenant B (wsB): pembanding.
insert into public.workspaces (id, owner_uid, name, plan, class_limit, seat_limit, invite_code, invite_code_expires_at) values
  ('wsA', 'ownerA', 'Sekolah A', 'school_annual', null, 10, 'INVITA', (extract(epoch from now() + interval '7 days') * 1000)::bigint),
  ('wsB', 'ownerB', 'Sekolah B', 'individual_lifetime', 3, null, null, null),
  ('wsS', 'ownerS', 'Sekolah Penuh', 'school_annual', 3, 1, 'INVS', (extract(epoch from now() + interval '7 days') * 1000)::bigint),
  ('wsX', 'ownerX', 'Sekolah Kedaluwarsa', 'school_annual', 3, 5, 'INVX', (extract(epoch from now() - interval '1 day') * 1000)::bigint);
insert into public.workspace_invites (code, workspace_id, expires_at) values
  ('INVITA', 'wsA', null), ('OLDA', 'wsA', null), ('INVS', 'wsS', null), ('INVX', 'wsX', null);
insert into public.teacher_profiles (user_id, workspace_id, role, homeroom_class_name, name) values
  ('ownerA', 'wsA', 'OWNER', null, 'Owner A'),
  ('adminA', 'wsA', 'ADMIN', null, 'Admin A'),
  ('teachA', 'wsA', 'TEACHER', null, 'Guru A'),
  ('hmA', 'wsA', 'TEACHER', '7A', 'Wali 7A'),
  ('ownerB', 'wsB', 'OWNER', null, 'Owner B'),
  ('teachB', 'wsB', 'TEACHER', null, 'Guru B'),
  ('ownerS', 'wsS', 'OWNER', null, 'Owner S'),
  ('newbie', null, null, null, 'Guru Baru');
insert into public.students (id, workspace_id, class_name, name) values
  ('sA1', 'wsA', '7A', 'Siswa A1'), ('sA2', 'wsA', '7B', 'Siswa A2'), ('sB1', 'wsB', '7A', 'Siswa B1');
insert into public.student_profiles (user_id, workspace_id, student_id, class_name, name) values
  ('stuA1', 'wsA', 'sA1', '7A', 'Siswa A1'), ('stuA2', 'wsA', 'sA2', '7B', 'Siswa A2'), ('stuB1', 'wsB', 'sB1', '7A', 'Siswa B1');
insert into public.student_login_codes (id, workspace_id, student_id, class_name, code, name, nis) values
  ('CODEA1', 'wsA', 'sA1', '7A', 'CODEA1', 'Siswa A1', '1001'), ('CODEA2', 'wsA', 'sA2', '7B', 'CODEA2', 'Siswa A2', null);
insert into public.academic_years (id, workspace_id, label) values ('ayA', 'wsA', '2026/2027');
insert into public.announcements (id, workspace_id, class_name, title) values ('anA7A', 'wsA', '7A', 'u7A'), ('anA7B', 'wsA', '7B', 'u7B');
insert into public.assignments (id, workspace_id, class_name, title, due_date) values
  ('aA7A', 'wsA', '7A', 'T7A', current_date + 7), ('aA7B', 'wsA', '7B', 'T7B', current_date + 7), ('aB', 'wsB', '7A', 'TB', current_date + 7);
insert into public.attendances (id, workspace_id, class_name, student_id, date, status) values
  ('atA7A', 'wsA', '7A', 'sA1', current_date, 'hadir'), ('atA7B', 'wsA', '7B', 'sA2', current_date, 'hadir');
insert into public.grade_columns (id, workspace_id, class_name, name) values ('gcA7A', 'wsA', '7A', 'UH1'), ('gcA7B', 'wsA', '7B', 'UH1');
insert into public.grades (id, workspace_id, class_name, student_id, column_id, score) values
  ('grA1', 'wsA', '7A', 'sA1', 'gcA7A', 80), ('grA2', 'wsA', '7B', 'sA2', 'gcA7B', 70);
insert into public.journals (id, workspace_id, class_name, date, teacher_uid) values ('jA', 'wsA', '7A', current_date, 'teachA');
insert into public.schedules (id, workspace_id, class_name, day) values ('scA7A', 'wsA', '7A', 'Senin'), ('scA7B', 'wsA', '7B', 'Senin');
insert into public.session_skip_reasons (id, workspace_id, class_name, teacher_uid, date, reason) values ('skA', 'wsA', '7A', 'teachA', current_date, 'rapat');
insert into public.class_fund_transactions (id, workspace_id, class_name, amount, type) values ('cfA7A', 'wsA', '7A', 10000, 'masuk');
insert into public.class_inventory (id, workspace_id, class_name, name, quantity) values ('ciA7A', 'wsA', '7A', 'Sapu', 1);
insert into public.student_notes (id, workspace_id, class_name, student_id, note, category) values
  ('nA7A', 'wsA', '7A', 'sA1', 'rahasia 7A', 'konseling'), ('nA7B', 'wsA', '7B', 'sA2', 'rahasia 7B', 'konseling');
insert into public.student_achievements (id, workspace_id, class_name, student_id, title) values
  ('acA1', 'wsA', '7A', 'sA1', 'Juara'), ('acA2', 'wsA', '7B', 'sA2', 'Juara 2');
insert into public.payments (order_id, workspace_id, status, amount) values ('ordA', 'wsA', 'settlement', 240000);
insert into public.submissions (id, workspace_id, class_name, assignment_id, student_id, status, text_answer, score, feedback, submitted_at) values
  ('aA7A_sA1', 'wsA', '7A', 'aA7A', 'sA1', 'menunggu_penilaian', 'jawaban', null, null, now()),
  ('aA7B_sA2', 'wsA', '7B', 'aA7B', 'sA2', 'dinilai', 'jawaban dinilai', 90, 'bagus', now());
