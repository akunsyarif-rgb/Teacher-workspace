-- BASELINE: salinan skema project Supabase "Workflow" per 2026-10-09, diekspor
-- READ-ONLY dari katalog Postgres (pg_class/pg_attribute/pg_constraint/
-- pg_trigger/pg_proc/pg_policies). Bukan migrasi: dipakai untuk uji RLS lokal
-- dan sebagai bahan tinjauan. Indeks sengaja tidak disertakan (hanya kinerja,
-- tidak memengaruhi RLS). Dijalankan SESUDAH test-support/000_auth_stub.sql.

create schema if not exists private;

create table public.workspaces (id text not null, owner_uid text not null, name text, invite_code text, invite_code_expires_at bigint, plan text, class_limit integer, seat_limit integer, plan_expires_at bigint, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.teacher_profiles (user_id text not null, workspace_id text, role text, homeroom_class_name text, name text, email text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.workspace_invites (code text not null, workspace_id text not null, expires_at bigint, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.payments (order_id text not null, workspace_id text not null, status text, amount numeric(14,2), currency text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), uid text, plan text, seat_count integer, gross_amount numeric, settled_at bigint);
create table public.students (id text not null, workspace_id text not null, class_name text not null, name text, nis text, nisn text, gender text, access_code text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.student_profiles (user_id text not null, workspace_id text not null, student_id text not null, class_name text not null, name text, nis text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.student_login_codes (id text not null, workspace_id text not null, student_id text not null, class_name text not null, code text not null, used_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), name text, nis text);
create table public.academic_years (id text not null, workspace_id text not null, label text, start_date date, end_date date, is_active boolean not null default false, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.announcements (id text not null, workspace_id text not null, class_name text, teacher_uid text, title text, body text, date date, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.assignments (id text not null, workspace_id text not null, class_name text, teacher_uid text, title text, description text, due_date date, subject text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), grade_column_id text, material_file_url text, material_file_name text, material_file_path text);
create table public.attendances (id text not null, workspace_id text not null, class_name text, student_id text, date date, status text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.class_fund_transactions (id text not null, workspace_id text not null, class_name text not null, student_id text, transaction_date date, amount numeric(14,2), type text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.class_inventory (id text not null, workspace_id text not null, class_name text not null, name text, quantity numeric(14,3), unit text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.grade_columns (id text not null, workspace_id text not null, class_name text, name text, weight numeric(8,3), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), title text, type text);
create table public.grades (id text not null, workspace_id text not null, class_name text, student_id text, column_id text, score numeric(8,3), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.journals (id text not null, workspace_id text not null, class_name text, date date, teacher_uid text, subject text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.schedules (id text not null, workspace_id text not null, class_name text, date date, day text, time_slot text, subject text, teacher_name text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.session_skip_reasons (id text not null, workspace_id text not null, class_name text, teacher_uid text, date date, reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.student_achievements (id text not null, workspace_id text not null, class_name text, student_id text, title text, description text, date date, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.student_notes (id text not null, workspace_id text not null, class_name text, student_id text, teacher_uid text, note text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), category text);
create table public.submissions (id text not null, workspace_id text not null, class_name text, assignment_id text not null, student_id text not null, submitted_at timestamptz, status text, score numeric(8,3), feedback text, text_answer text, external_link jsonb, attachments jsonb not null default '[]'::jsonb, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- Primary key & unique
alter table public.workspaces add primary key (id);
alter table public.teacher_profiles add primary key (user_id);
alter table public.workspace_invites add primary key (code);
alter table public.payments add primary key (order_id);
alter table public.students add primary key (id);
alter table public.student_profiles add primary key (user_id);
alter table public.student_login_codes add primary key (id);
alter table public.student_login_codes add constraint student_login_codes_workspace_id_code_key unique (workspace_id, code);
alter table public.academic_years add primary key (id);
alter table public.announcements add primary key (id);
alter table public.assignments add primary key (id);
alter table public.attendances add primary key (id);
alter table public.class_fund_transactions add primary key (id);
alter table public.class_inventory add primary key (id);
alter table public.grade_columns add primary key (id);
alter table public.grades add primary key (id);
alter table public.grades add constraint grades_workspace_id_student_id_column_id_key unique (workspace_id, student_id, column_id);
alter table public.journals add primary key (id);
alter table public.schedules add primary key (id);
alter table public.session_skip_reasons add primary key (id);
alter table public.student_achievements add primary key (id);
alter table public.student_notes add primary key (id);
alter table public.submissions add primary key (id);
alter table public.submissions add constraint submissions_assignment_id_student_id_key unique (assignment_id, student_id);

-- Foreign key (workspace_id -> workspaces.id)
alter table public.academic_years add foreign key (workspace_id) references public.workspaces(id);
alter table public.payments add foreign key (workspace_id) references public.workspaces(id) on delete restrict;
alter table public.teacher_profiles add foreign key (workspace_id) references public.workspaces(id) on delete restrict;
alter table public.announcements add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.assignments add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.attendances add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.class_fund_transactions add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.class_inventory add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.grade_columns add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.grades add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.journals add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.schedules add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.session_skip_reasons add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.student_achievements add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.student_login_codes add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.student_notes add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.student_profiles add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.students add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.submissions add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.workspace_invites add foreign key (workspace_id) references public.workspaces(id) on delete cascade;
-- Foreign key lain
alter table public.attendances add foreign key (student_id) references public.students(id) on delete set null;
alter table public.class_fund_transactions add foreign key (student_id) references public.students(id) on delete set null;
alter table public.grades add foreign key (student_id) references public.students(id) on delete set null;
alter table public.grades add foreign key (column_id) references public.grade_columns(id) on delete cascade;
alter table public.student_achievements add foreign key (student_id) references public.students(id) on delete cascade;
alter table public.student_login_codes add foreign key (student_id) references public.students(id) on delete cascade;
alter table public.student_notes add foreign key (student_id) references public.students(id) on delete cascade;
alter table public.student_profiles add foreign key (student_id) references public.students(id) on delete cascade;
alter table public.submissions add foreign key (assignment_id) references public.assignments(id) on delete cascade;
alter table public.submissions add foreign key (student_id) references public.students(id) on delete cascade;
