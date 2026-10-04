-- Teacher Workspace — Supabase foundation
-- Phase 1: schema only. This migration does NOT read, move, or delete Firebase data.
-- Existing production Firebase remains the source of truth until a later cutover.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id text primary key,
  owner_uid text not null,
  name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.teacher_profiles (
  id text primary key,
  workspace_id text,
  role text,
  email text,
  display_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.students (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.schedules (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.journals (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.attendances (
  id text primary key,
  workspace_id text not null,
  class_name text,
  student_id text,
  date date,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.grades (
  id text primary key,
  workspace_id text not null,
  class_name text,
  student_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.grade_columns (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.class_fund_transactions (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.class_inventory (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.student_notes (
  id text primary key,
  workspace_id text not null,
  class_name text,
  student_id text,
  category text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.assignments (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.submissions (
  id text primary key,
  workspace_id text not null,
  assignment_id text,
  student_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.announcements (
  id text primary key,
  workspace_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.student_login_codes (
  id text primary key,
  workspace_id text,
  student_id text,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.student_profiles (
  id text primary key,
  workspace_id text not null,
  student_id text not null,
  class_name text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.student_achievements (
  id text primary key,
  workspace_id text not null,
  class_name text,
  student_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.session_skip_reasons (
  id text primary key,
  workspace_id text not null,
  class_name text,
  date date,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.academic_years (
  id text primary key,
  workspace_id text not null,
  label text,
  start_date date,
  end_date date,
  is_active boolean,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.workspace_invites (
  id text primary key,
  workspace_id text not null,
  expires_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists public.payments (
  id text primary key,
  workspace_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

-- Indexes needed by the current repository access patterns.
create index if not exists idx_teacher_profiles_workspace on public.teacher_profiles(workspace_id);
create index if not exists idx_students_workspace_class on public.students(workspace_id, class_name);
create index if not exists idx_schedules_workspace_class on public.schedules(workspace_id, class_name);
create index if not exists idx_journals_workspace_class on public.journals(workspace_id, class_name);
create index if not exists idx_attendances_workspace_class_date on public.attendances(workspace_id, class_name, date);
create index if not exists idx_grades_workspace_class_student on public.grades(workspace_id, class_name, student_id);
create index if not exists idx_grade_columns_workspace_class on public.grade_columns(workspace_id, class_name);
create index if not exists idx_class_fund_workspace_class on public.class_fund_transactions(workspace_id, class_name);
create index if not exists idx_class_inventory_workspace_class on public.class_inventory(workspace_id, class_name);
create index if not exists idx_student_notes_workspace_class_student on public.student_notes(workspace_id, class_name, student_id);
create index if not exists idx_assignments_workspace_class on public.assignments(workspace_id, class_name);
create index if not exists idx_submissions_workspace_assignment_student on public.submissions(workspace_id, assignment_id, student_id);
create index if not exists idx_announcements_workspace_class on public.announcements(workspace_id, class_name);
create index if not exists idx_student_login_codes_workspace_student on public.student_login_codes(workspace_id, student_id);
create index if not exists idx_student_profiles_workspace_student on public.student_profiles(workspace_id, student_id);
create index if not exists idx_student_achievements_workspace_student on public.student_achievements(workspace_id, student_id);
create index if not exists idx_session_skip_workspace_class_date on public.session_skip_reasons(workspace_id, class_name, date);
create index if not exists idx_academic_years_workspace on public.academic_years(workspace_id);
create index if not exists idx_workspace_invites_workspace on public.workspace_invites(workspace_id);
create index if not exists idx_payments_workspace on public.payments(workspace_id);

-- RLS is enabled now, but policies are intentionally added in the next phase
-- after Firebase-auth/Supabase JWT integration is configured and tested.
-- Fail-closed is safer than exposing a partially migrated production schema.
do $$
declare
  t text;
begin
  foreach t in array array[
    'workspaces','teacher_profiles','students','schedules','journals','attendances',
    'grades','grade_columns','class_fund_transactions','class_inventory','student_notes',
    'assignments','submissions','announcements','student_login_codes','student_profiles',
    'student_achievements','session_skip_reasons','academic_years','workspace_invites','payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
