-- Teacher Workspace -> Supabase foundation
-- Phase 1 only: schema/RLS foundation. No Firebase data is modified.
-- Firestore document IDs are preserved as text so a later migration can be
-- deterministic and reversible.

create extension if not exists pgcrypto;

create type public.teacher_role as enum (
  'OWNER',
  'ADMIN',
  'TEACHER'
);

create type public.workspace_plan as enum (
  'FREE',
  'PRO'
);

create table public.workspaces (
  id text primary key,
  name text not null,
  owner_uid uuid,
  plan public.workspace_plan not null default 'FREE',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.teacher_role not null default 'TEACHER',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members(user_id);
create index workspace_members_workspace_role_idx on public.workspace_members(workspace_id, role);

create table public.teacher_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id text references public.workspaces(id) on delete set null,
  role public.teacher_role,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index teacher_profiles_workspace_idx on public.teacher_profiles(workspace_id);

-- The application currently stores className directly on many Firestore
-- documents. Keep that denormalized field in this first migration so the
-- cutover does not silently combine backend migration with a classId redesign.
create table public.students (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  name text,
  nisn text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index students_workspace_class_idx on public.students(workspace_id, class_name);
create index students_workspace_nisn_idx on public.students(workspace_id, nisn);

create table public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  student_id text references public.students(id) on delete set null,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index student_profiles_workspace_class_idx on public.student_profiles(workspace_id, class_name);
create index student_profiles_student_idx on public.student_profiles(student_id);

create table public.student_login_codes (
  code text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  student_id text references public.students(id) on delete set null,
  class_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index student_login_codes_workspace_class_idx on public.student_login_codes(workspace_id, class_name);
create index student_login_codes_student_idx on public.student_login_codes(student_id);

create table public.workspace_invites (
  invite_code text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  expires_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table public.academic_years (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table public.journals (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  date date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index journals_workspace_date_idx on public.journals(workspace_id, date);
create index journals_workspace_class_date_idx on public.journals(workspace_id, class_name, date);

create table public.attendances (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  date date,
  student_id text references public.students(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index attendances_workspace_date_idx on public.attendances(workspace_id, date);
create index attendances_workspace_class_date_idx on public.attendances(workspace_id, class_name, date);
create index attendances_student_date_idx on public.attendances(student_id, date);

create table public.grades (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  student_id text references public.students(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index grades_workspace_class_student_idx on public.grades(workspace_id, class_name, student_id);

create table public.grade_columns (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index grade_columns_workspace_class_idx on public.grade_columns(workspace_id, class_name);

create table public.schedules (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index schedules_workspace_class_idx on public.schedules(workspace_id, class_name);

create table public.class_fund_transactions (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index class_fund_workspace_class_idx on public.class_fund_transactions(workspace_id, class_name);

create table public.class_inventory (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index class_inventory_workspace_class_idx on public.class_inventory(workspace_id, class_name);

create table public.student_notes (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  student_id text references public.students(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index student_notes_workspace_class_student_idx on public.student_notes(workspace_id, class_name, student_id);

create table public.assignments (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  due_date timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index assignments_workspace_due_date_idx on public.assignments(workspace_id, due_date);
create index assignments_workspace_class_due_date_idx on public.assignments(workspace_id, class_name, due_date);

create table public.submissions (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  assignment_id text references public.assignments(id) on delete set null,
  student_id text references public.students(id) on delete set null,
  submitted_at timestamptz,
  external_link jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index submissions_workspace_submitted_idx on public.submissions(workspace_id, submitted_at);
create index submissions_assignment_student_idx on public.submissions(assignment_id, student_id);

create table public.announcements (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  date date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index announcements_workspace_date_idx on public.announcements(workspace_id, date);

create table public.student_achievements (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text not null,
  student_id text references public.students(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index student_achievements_workspace_class_student_idx on public.student_achievements(workspace_id, class_name, student_id);

create table public.session_skip_reasons (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  class_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create index session_skip_reasons_workspace_class_idx on public.session_skip_reasons(workspace_id, class_name);

-- Generic updated_at helper. Existing timestamps remain nullable because the
-- Firestore migration must preserve historical values exactly.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger workspace_members_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();
create trigger teacher_profiles_updated_at before update on public.teacher_profiles for each row execute function public.set_updated_at();
create trigger students_updated_at before update on public.students for each row execute function public.set_updated_at();
create trigger student_profiles_updated_at before update on public.student_profiles for each row execute function public.set_updated_at();
create trigger student_login_codes_updated_at before update on public.student_login_codes for each row execute function public.set_updated_at();
create trigger workspace_invites_updated_at before update on public.workspace_invites for each row execute function public.set_updated_at();
create trigger academic_years_updated_at before update on public.academic_years for each row execute function public.set_updated_at();
create trigger journals_updated_at before update on public.journals for each row execute function public.set_updated_at();
create trigger attendances_updated_at before update on public.attendances for each row execute function public.set_updated_at();
create trigger grades_updated_at before update on public.grades for each row execute function public.set_updated_at();
create trigger grade_columns_updated_at before update on public.grade_columns for each row execute function public.set_updated_at();
create trigger schedules_updated_at before update on public.schedules for each row execute function public.set_updated_at();
create trigger class_fund_transactions_updated_at before update on public.class_fund_transactions for each row execute function public.set_updated_at();
create trigger class_inventory_updated_at before update on public.class_inventory for each row execute function public.set_updated_at();
create trigger student_notes_updated_at before update on public.student_notes for each row execute function public.set_updated_at();
create trigger assignments_updated_at before update on public.assignments for each row execute function public.set_updated_at();
create trigger submissions_updated_at before update on public.submissions for each row execute function public.set_updated_at();
create trigger announcements_updated_at before update on public.announcements for each row execute function public.set_updated_at();
create trigger student_achievements_updated_at before update on public.student_achievements for each row execute function public.set_updated_at();
create trigger session_skip_reasons_updated_at before update on public.session_skip_reasons for each row execute function public.set_updated_at();

-- Security helpers. They are intentionally SECURITY DEFINER with a fixed
-- search_path so RLS checks cannot recurse through workspace_members policies.
create or replace function public.is_workspace_member(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_teacher(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('OWNER', 'ADMIN', 'TEACHER')
  );
$$;

create or replace function public.is_workspace_admin(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('OWNER', 'ADMIN')
  );
$$;

-- RLS is enabled now, before any application cutover, so accidentally
-- exposing the new project with the anon/publishable key cannot make tables
-- public. Policies are intentionally conservative: teachers may access their
-- own workspace rows; student access is limited to their own profile/submission
-- rows. More granular class/role policies are added with the repository
-- cutover, after the exact Firestore rule matrix has been ported and tested.

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.students enable row level security;
alter table public.student_profiles enable row level security;
alter table public.student_login_codes enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.academic_years enable row level security;
alter table public.journals enable row level security;
alter table public.attendances enable row level security;
alter table public.grades enable row level security;
alter table public.grade_columns enable row level security;
alter table public.schedules enable row level security;
alter table public.class_fund_transactions enable row level security;
alter table public.class_inventory enable row level security;
alter table public.student_notes enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.announcements enable row level security;
alter table public.student_achievements enable row level security;
alter table public.session_skip_reasons enable row level security;

create policy workspace_select_member on public.workspaces for select using (public.is_workspace_member(id));
create policy workspace_update_admin on public.workspaces for update using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));

create policy members_select_self_workspace on public.workspace_members for select using (user_id = auth.uid() or public.is_workspace_admin(workspace_id));
create policy members_manage_admin on public.workspace_members for all using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));

create policy teacher_profile_self on public.teacher_profiles for select using (user_id = auth.uid());
create policy teacher_profile_update_self on public.teacher_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy students_select_teacher_workspace on public.students for select using (public.is_workspace_teacher(workspace_id));
create policy students_write_teacher_workspace on public.students for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));

create policy student_profile_self on public.student_profiles for select using (user_id = auth.uid());
create policy student_profile_teacher_read on public.student_profiles for select using (public.is_workspace_teacher(workspace_id));

-- Login-code lookup is intentionally NOT opened by workspace membership.
-- During auth migration this table will be accessed through a server/RPC claim
-- operation so a student cannot enumerate codes with the publishable key.

create policy academic_years_teacher on public.academic_years for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy journals_teacher on public.journals for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy attendances_teacher on public.attendances for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy grades_teacher on public.grades for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy grade_columns_teacher on public.grade_columns for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy schedules_teacher on public.schedules for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy class_fund_teacher on public.class_fund_transactions for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy class_inventory_teacher on public.class_inventory for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy student_notes_teacher on public.student_notes for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy assignments_teacher on public.assignments for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy announcements_teacher on public.announcements for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy student_achievements_teacher on public.student_achievements for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));
create policy session_skip_reasons_teacher on public.session_skip_reasons for all using (public.is_workspace_teacher(workspace_id)) with check (public.is_workspace_teacher(workspace_id));

-- Submissions: teacher can review workspace submissions; students can only
-- read/write their own submission rows once student_id is linked to their
-- profile. The final migration will additionally enforce deadline/grade-lock
-- semantics at the service/RPC layer.
create policy submissions_teacher on public.submissions for select using (public.is_workspace_teacher(workspace_id));
create policy submissions_student_select on public.submissions for select using (
  exists (
    select 1 from public.student_profiles sp
    where sp.user_id = auth.uid()
      and sp.student_id = submissions.student_id
      and sp.workspace_id = submissions.workspace_id
  )
);
create policy submissions_student_insert on public.submissions for insert with check (
  exists (
    select 1 from public.student_profiles sp
    where sp.user_id = auth.uid()
      and sp.student_id = submissions.student_id
      and sp.workspace_id = submissions.workspace_id
  )
);
create policy submissions_student_update on public.submissions for update using (
  exists (
    select 1 from public.student_profiles sp
    where sp.user_id = auth.uid()
      and sp.student_id = submissions.student_id
      and sp.workspace_id = submissions.workspace_id
  )
) with check (
  exists (
    select 1 from public.student_profiles sp
    where sp.user_id = auth.uid()
      and sp.student_id = submissions.student_id
      and sp.workspace_id = submissions.workspace_id
  )
);

-- External Google Drive links are metadata only. The existing application
-- validator remains the first UX guard; the database cutover will repeat the
-- provider/HTTPS/host validation in a CHECK constraint or RPC before writes.

-- Deliberately no public policies for workspace_invites or student_login_codes.
-- Those are bridge/authentication records and must not be enumerable.
