-- BASELINE (lihat 001_schema.sql). Policy dan grant setara produksi; policy
-- berpola sama dibangkitkan lewat loop (nama policy sama dengan produksi).
-- Sintaks `(select private.fn(...))` = pola initplan produksi.

alter table public.workspaces enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.payments enable row level security;
alter table public.students enable row level security;
alter table public.student_profiles enable row level security;
alter table public.student_login_codes enable row level security;
alter table public.academic_years enable row level security;
alter table public.announcements enable row level security;
alter table public.assignments enable row level security;
alter table public.attendances enable row level security;
alter table public.class_fund_transactions enable row level security;
alter table public.class_inventory enable row level security;
alter table public.grade_columns enable row level security;
alter table public.grades enable row level security;
alter table public.journals enable row level security;
alter table public.schedules enable row level security;
alter table public.session_skip_reasons enable row level security;
alter table public.student_achievements enable row level security;
alter table public.student_notes enable row level security;
alter table public.submissions enable row level security;

-- Guru mana pun di workspace: CRUD penuh
do $$
declare r record;
begin
  for r in select * from (values
    ('academic_years','academic_years'),('announcements','announcements'),('assignments','assignments'),
    ('attendances','attendances'),('grade_columns','grade_columns'),('grades','grades'),('journals','journals'),
    ('schedules','schedules'),('session_skip_reasons','session_skip'),('students','students'),
    ('student_login_codes','student_login_codes'),('submissions','submissions')
  ) as v(tbl, prefix) loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_teacher_workspace(workspace_id)))', r.prefix||'_teacher_select', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_teacher_workspace(workspace_id)))', r.prefix||'_teacher_insert', r.tbl);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_teacher_workspace(workspace_id))) with check ((select private.is_teacher_workspace(workspace_id)))', r.prefix||'_teacher_update', r.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_teacher_workspace(workspace_id)))', r.prefix||'_teacher_delete', r.tbl);
  end loop;
end $$;

-- Siswa: baca per kelas
create policy announcements_student_select on public.announcements for select to authenticated using ((select private.is_student_class(workspace_id, class_name)));
create policy assignments_student_select on public.assignments for select to authenticated using ((select private.is_student_class(workspace_id, class_name)));
create policy attendances_student_select on public.attendances for select to authenticated using ((select private.is_student_class(workspace_id, class_name)));
create policy grade_columns_student_select on public.grade_columns for select to authenticated using ((select private.is_student_class(workspace_id, class_name)));
create policy schedules_student_select on public.schedules for select to authenticated using ((select private.is_student_class(workspace_id, class_name)));
-- Siswa: baca milik sendiri
create policy grades_student_select on public.grades for select to authenticated using ((select private.is_own_student(workspace_id, student_id)));
create policy student_achievements_student_select on public.student_achievements for select to authenticated using ((select private.is_own_student(workspace_id, student_id)));
create policy submissions_student_select on public.submissions for select to authenticated using ((select private.is_own_student(workspace_id, student_id)));

-- Kas kelas & inventaris: baca semua guru, tulis wali kelas
do $$
declare r record;
begin
  for r in select * from (values ('class_fund_transactions','class_fund'),('class_inventory','class_inventory')) as v(tbl, prefix) loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_teacher_workspace(workspace_id)))', r.prefix||'_teacher_select', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_homeroom_of(workspace_id, class_name)))', r.prefix||'_teacher_insert', r.tbl);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_homeroom_of(workspace_id, class_name))) with check ((select private.is_homeroom_of(workspace_id, class_name)))', r.prefix||'_teacher_update', r.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_homeroom_of(workspace_id, class_name)))', r.prefix||'_teacher_delete', r.tbl);
  end loop;
  -- Catatan siswa & prestasi: baca wali kelas atau admin/owner, tulis wali kelas
  for r in select * from (values ('student_notes'),('student_achievements')) as v(tbl) loop
    execute format('create policy %I on public.%I for select to authenticated using (((select private.is_homeroom_of(workspace_id, class_name)) or (select private.is_teacher_admin_or_owner(workspace_id))))', r.tbl||'_teacher_select', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_homeroom_of(workspace_id, class_name)))', r.tbl||'_teacher_insert', r.tbl);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_homeroom_of(workspace_id, class_name))) with check ((select private.is_homeroom_of(workspace_id, class_name)))', r.tbl||'_teacher_update', r.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_homeroom_of(workspace_id, class_name)))', r.tbl||'_teacher_delete', r.tbl);
  end loop;
end $$;

-- Submissions: sisi siswa
create policy submissions_student_insert on public.submissions for insert to authenticated with check (
  (select private.is_own_student(workspace_id, student_id)) and status = 'menunggu_penilaian' and coalesce(feedback, '') = ''
  and (external_link is null or ((external_link ->> 'provider') = 'google-drive' and coalesce(external_link ->> 'url', '') ~ '^https://(drive|docs)[.]google[.]com(/.*)?$')));
create policy submissions_student_update on public.submissions for update to authenticated
  using ((select private.is_own_student(workspace_id, student_id)))
  with check ((select private.is_own_student(workspace_id, student_id)) and status = 'menunggu_penilaian'
  and (external_link is null or ((external_link ->> 'provider') = 'google-drive' and coalesce(external_link ->> 'url', '') ~ '^https://(drive|docs)[.]google[.]com(/.*)?$')));

-- Profil
create policy student_profiles_self_select on public.student_profiles for select to authenticated using (user_id = (select private.current_uid()));
create policy student_profiles_self_insert on public.student_profiles for insert to authenticated with check (user_id = (select private.current_uid()));
create policy teacher_profiles_self_select on public.teacher_profiles for select to authenticated using (user_id = (select private.current_uid()));
create policy teacher_profiles_admin_select on public.teacher_profiles for select to authenticated using ((select private.is_teacher_admin_or_owner(workspace_id)));
create policy teacher_profiles_self_insert on public.teacher_profiles for insert to authenticated with check (user_id = (select private.current_uid()) and homeroom_class_name is null and (select private.can_claim_role(role, workspace_id)));
create policy teacher_profiles_self_update on public.teacher_profiles for update to authenticated using (user_id = (select private.current_uid())) with check (user_id = (select private.current_uid()));

-- Workspace, undangan, pembayaran
create policy workspaces_owner_insert on public.workspaces for insert to authenticated with check (owner_uid = (select private.current_uid()));
create policy workspaces_invite_preview on public.workspaces for select to authenticated using (false);
create policy workspaces_member_select on public.workspaces for select to authenticated using ((owner_uid = (select private.current_uid())) or (select private.is_teacher_workspace(id)));
create policy workspaces_owner_update on public.workspaces for update to authenticated using (owner_uid = (select private.current_uid()))
  with check (owner_uid = (select private.current_uid()) and (select private.plan_fields_unchanged(id, plan, class_limit, seat_limit, plan_expires_at)));
create policy workspace_invites_get on public.workspace_invites for select to authenticated using ((select private.is_workspace_owner(workspace_id)));
create policy workspace_invites_owner_insert on public.workspace_invites for insert to authenticated with check ((select private.is_workspace_owner(workspace_id)));
create policy workspace_invites_owner_update on public.workspace_invites for update to authenticated using ((select private.is_workspace_owner(workspace_id))) with check ((select private.is_workspace_owner(workspace_id)));
create policy workspace_invites_owner_delete on public.workspace_invites for delete to authenticated using ((select private.is_workspace_owner(workspace_id)));
create policy payments_owner_select on public.payments for select to authenticated using ((select private.is_workspace_owner(workspace_id)));

-- Grant: anon tanpa hak; authenticated CRUD (dibatasi RLS), payments hanya SELECT
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.payments from authenticated;
revoke execute on all functions in schema public, private from public, anon;
grant execute on function
  private.can_claim_role(text,text), private.current_uid(), private.is_homeroom_of(text,text), private.is_own_student(text,text),
  private.is_student_class(text,text), private.is_student_workspace(text), private.is_teacher_admin_or_owner(text),
  private.is_teacher_workspace(text), private.is_workspace_owner(text), private.plan_fields_unchanged(text,text,integer,integer,bigint),
  public.claim_student_login_code(text), public.lookup_workspace_invite(text)
  to authenticated;
