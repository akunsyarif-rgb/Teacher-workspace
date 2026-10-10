-- USULAN MIGRASI — BELUM DITERAPKAN KE PROJECT SUPABASE MANA PUN. Ditinjau lewat PR; diterapkan hanya
-- setelah persetujuan eksplisit pemilik. Diuji lokal (Postgres biasa + stub auth), BUKAN di Supabase nyata.
--
-- Modul Ulangan Harian (UH) Teacher Workspace. Seluruh data ujian hidup di Supabase (bukan Firestore).
-- Identitas: private.current_uid() = claim `sub` (uid Firebase), dipetakan ke peran lewat ulh_members (lihat di bawah). Pola mesin ujian diadaptasi dari SmadaExam (start/save/submit/report_security_event),
-- ditulis ulang karena skema identitas berbeda (text uid, kelas = class_name, bukan auth.uid() uuid).
--
-- IDENTITAS (blocker yang dipecahkan di sini): teacher_profiles/student_profiles/students di Supabase masih KOSONG selama
-- migrasi Firestore→Supabase ditahan, sehingga RPC tidak bisa mengenali siapa pun. Modul ini TIDAK membuat identitas palsu dan
-- TIDAK menyentuh tabel identitas produksi. Sebagai gantinya ada proyeksi khusus modul:
--   ulh_members (guru/siswa → workspace, peran, kelas) dan ulh_roster (daftar siswa per workspace).
-- Hanya service_role (server Next.js) yang bisa menulisnya, setelah memverifikasi ID token Firebase dan membaca kebenaran di
-- Firestore (app/api/ulangan/sync-identity). Klien (authenticated/anon) tidak punya grant maupun policy apa pun pada keduanya.
-- Proyeksi punya TTL (guru 30 menit, siswa 6 jam) agar pencabutan hak di Firestore terbawa (fail-closed bila sinkronisasi berhenti).
-- Setelah cutover, cukup ganti isi private.ulh_teacher_ctx()/ulh_student_ctx()/ulh_manages_*() ke tabel identitas asli.
--
-- Prinsip:
--  * RLS deny-by-default. Siswa TIDAK punya policy/grant pada tabel ulh_* sama sekali; semua lewat RPC SECURITY DEFINER.
--  * Guru menulis hanya lewat RPC (validasi di server); policy tulis langsung tidak ada.
--  * workspace_id, guru/siswa, kelas, skor, waktu, status SELALU diturunkan server, tidak pernah dari payload.
--  * Kunci jawaban hanya di ulh_question_keys (guru pengelola) dan dibaca fungsi penilaian private.
--  * Timer memakai clock_timestamp() server; expires_at = least(mulai + durasi, penutupan ujian).

-- ---------- Tabel ----------
create table public.ulh_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  created_by text not null,
  title text not null check (char_length(title) between 1 and 200),
  subject text not null default '' check (char_length(subject) <= 100),
  status text not null default 'draft' check (status in ('draft', 'final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ulh_packages_ws_idx on public.ulh_packages (workspace_id, created_by);

create table public.ulh_questions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.ulh_packages (id) on delete cascade,
  workspace_id text not null,
  position integer not null check (position >= 1),
  body text not null check (char_length(body) between 1 and 2000),
  points integer not null default 1 check (points between 1 and 100),
  created_at timestamptz not null default now(),
  unique (package_id, position)
);
create index ulh_questions_pkg_idx on public.ulh_questions (package_id);

create table public.ulh_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.ulh_questions (id) on delete cascade,
  workspace_id text not null,
  position integer not null check (position >= 1),
  label text not null check (char_length(label) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (question_id, position),
  unique (id, question_id)
);

-- Kunci jawaban terpisah dari soal; FK komposit memastikan opsi kunci milik soal yang sama.
create table public.ulh_question_keys (
  question_id uuid primary key references public.ulh_questions (id) on delete cascade,
  workspace_id text not null,
  option_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (option_id, question_id) references public.ulh_options (id, question_id) on delete cascade
);

create table public.ulh_exams (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  package_id uuid not null references public.ulh_packages (id) on delete restrict,
  created_by text not null,
  title text not null check (char_length(title) between 1 and 200),
  duration_minutes integer not null check (duration_minutes between 1 and 300),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  shuffle_questions boolean not null default true,
  shuffle_options boolean not null default true,
  show_result boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index ulh_exams_ws_idx on public.ulh_exams (workspace_id, status);
create index ulh_exams_pkg_idx on public.ulh_exams (package_id);

create table public.ulh_exam_classes (
  exam_id uuid not null references public.ulh_exams (id) on delete cascade,
  workspace_id text not null,
  class_name text not null check (char_length(class_name) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (exam_id, class_name)
);
create index ulh_exam_classes_ws_idx on public.ulh_exam_classes (workspace_id, class_name);

create table public.ulh_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.ulh_exams (id) on delete cascade,
  workspace_id text not null,
  user_id text not null,
  student_id text not null,
  class_name text not null,
  status text not null default 'active' check (status in ('active', 'submitted', 'expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  score numeric(6, 2),
  max_score integer,
  correct_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > started_at),
  unique (exam_id, student_id)
);
create index ulh_attempts_exam_idx on public.ulh_attempts (exam_id, status);
create index ulh_attempts_user_idx on public.ulh_attempts (user_id);

-- Blueprint acak per attempt, disimpan sekali: urutan soal + urutan opsi.
create table public.ulh_attempt_questions (
  attempt_id uuid not null references public.ulh_attempts (id) on delete cascade,
  question_id uuid not null references public.ulh_questions (id) on delete cascade,
  workspace_id text not null,
  position integer not null check (position >= 1),
  option_order uuid[] not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, question_id),
  unique (attempt_id, position)
);

create table public.ulh_answers (
  attempt_id uuid not null,
  question_id uuid not null,
  workspace_id text not null,
  option_id uuid not null references public.ulh_options (id) on delete cascade,
  client_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id),
  foreign key (attempt_id, question_id) references public.ulh_attempt_questions (attempt_id, question_id) on delete cascade
);

-- Kejadian integritas = INDIKASI, bukan vonis. Severity ditentukan server; tidak ada sanksi otomatis.
create table public.ulh_integrity_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ulh_attempts (id) on delete cascade,
  workspace_id text not null,
  client_event_id uuid not null,
  event_type text not null check (event_type in
    ('TAB_SWITCH', 'WINDOW_BLUR', 'VISIBILITY_LOST', 'FULLSCREEN_EXIT', 'NETWORK_LOST', 'NETWORK_RECONNECTED')),
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  warning_level integer not null default 0 check (warning_level between 0 and 3),
  occurred_at timestamptz not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now(),
  unique (attempt_id, client_event_id)
);
create index ulh_integrity_attempt_idx on public.ulh_integrity_events (attempt_id, occurred_at);

create table public.ulh_audit_log (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  actor_uid text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ulh_audit_ws_idx on public.ulh_audit_log (workspace_id, created_at desc);

-- Proyeksi identitas (ditulis HANYA oleh service_role dari server; lihat catatan di atas).
create table public.ulh_members (
  user_id text primary key,
  kind text not null check (kind in ('teacher', 'student')),
  workspace_id text not null check (char_length(workspace_id) between 1 and 200),
  role text check (role in ('OWNER', 'ADMIN', 'TEACHER')),
  student_id text,
  class_name text,
  name text,
  synced_at timestamptz not null default now(),
  check ((kind = 'teacher' and role is not null and student_id is null)
      or (kind = 'student' and role is null and student_id is not null and class_name is not null))
);
create index ulh_members_ws_idx on public.ulh_members (workspace_id, kind);

create table public.ulh_roster (
  workspace_id text not null,
  student_id text not null,
  class_name text not null check (char_length(class_name) between 1 and 100),
  name text,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, student_id)
);
create index ulh_roster_class_idx on public.ulh_roster (workspace_id, class_name);

-- workspace_id & created_at tidak boleh berubah (trigger yang sama dengan tabel lain); updated_at dari server.
do $$
declare t text;
begin
  foreach t in array array['ulh_packages', 'ulh_exams', 'ulh_attempts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.protect_immutable_columns()', t || '_immutable', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------- Helper identitas (SECURITY DEFINER, tidak dapat dipanggil klien) ----------
create or replace function private.ulh_teacher_ctx() returns table (uid text, ws text, role text)
language plpgsql stable security definer set search_path to '' as $f$
begin
  return query select m.user_id, m.workspace_id, m.role
    from public.ulh_members m
    where m.user_id = private.current_uid() and m.kind = 'teacher' and m.synced_at > clock_timestamp() - interval '30 minutes';
  if not found then raise exception 'not_a_teacher' using errcode = '42501'; end if;
end;
$f$;

create or replace function private.ulh_student_ctx() returns table (uid text, ws text, student_id text, class_name text)
language plpgsql stable security definer set search_path to '' as $f$
begin
  return query select m.user_id, m.workspace_id, m.student_id, m.class_name
    from public.ulh_members m
    where m.user_id = private.current_uid() and m.kind = 'student' and m.synced_at > clock_timestamp() - interval '6 hours';
  if not found then raise exception 'not_a_student' using errcode = '42501'; end if;
end;
$f$;

create or replace function private.ulh_manages_package(p_id uuid) returns boolean
language sql stable security definer set search_path to '' as $f$
  select exists (select 1 from public.ulh_packages pk
    join public.ulh_members tp on tp.workspace_id = pk.workspace_id and tp.user_id = private.current_uid()
      and tp.kind = 'teacher' and tp.synced_at > clock_timestamp() - interval '30 minutes'
    where pk.id = p_id and (pk.created_by = tp.user_id or tp.role in ('OWNER', 'ADMIN')));
$f$;

create or replace function private.ulh_manages_exam(p_id uuid) returns boolean
language sql stable security definer set search_path to '' as $f$
  select exists (select 1 from public.ulh_exams e
    join public.ulh_members tp on tp.workspace_id = e.workspace_id and tp.user_id = private.current_uid()
      and tp.kind = 'teacher' and tp.synced_at > clock_timestamp() - interval '30 minutes'
    where e.id = p_id and (e.created_by = tp.user_id or tp.role in ('OWNER', 'ADMIN')));
$f$;

create or replace function private.ulh_is_admin_of(p_ws text) returns boolean
language sql stable security definer set search_path to '' as $f$
  select exists (select 1 from public.ulh_members m where m.user_id = private.current_uid() and m.kind = 'teacher'
    and m.workspace_id = p_ws and m.role in ('OWNER', 'ADMIN') and m.synced_at > clock_timestamp() - interval '30 minutes');
$f$;

create or replace function private.ulh_manages_attempt(p_id uuid) returns boolean
language sql stable security definer set search_path to '' as $f$
  select exists (select 1 from public.ulh_attempts a where a.id = p_id and private.ulh_manages_exam(a.exam_id));
$f$;

create or replace function private.ulh_audit(p_ws text, p_actor text, p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path to '' as $f$
  insert into public.ulh_audit_log (workspace_id, actor_uid, action, entity, entity_id, details)
  values (p_ws, p_actor, p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$f$;

-- Penilaian di server. Memegang kunci baris attempt dari pemanggil. Skor 0..100.
create or replace function private.ulh_finalize(p_attempt_id uuid, p_status text) returns void
language plpgsql security definer set search_path to '' as $f$
declare
  v_max integer; v_earned integer; v_correct integer; v_a public.ulh_attempts;
begin
  select * into v_a from public.ulh_attempts where id = p_attempt_id;
  if v_a.status <> 'active' then return; end if;
  select coalesce(sum(q.points), 0),
         coalesce(sum(q.points) filter (where k.option_id = an.option_id), 0),
         count(*) filter (where k.option_id = an.option_id)
    into v_max, v_earned, v_correct
  from public.ulh_attempt_questions aq
  join public.ulh_questions q on q.id = aq.question_id
  left join public.ulh_question_keys k on k.question_id = q.id
  left join public.ulh_answers an on an.attempt_id = aq.attempt_id and an.question_id = aq.question_id
  where aq.attempt_id = p_attempt_id;
  update public.ulh_attempts
     set status = p_status,
         submitted_at = greatest(started_at, least(clock_timestamp(), expires_at)),
         score = case when v_max > 0 then round(v_earned * 100.0 / v_max, 2) else 0 end,
         max_score = v_max,
         correct_count = v_correct
   where id = p_attempt_id;
end;
$f$;

-- ---------- RPC guru ----------
create or replace function public.ulh_save_package(p_package jsonb) returns uuid
language plpgsql security definer set search_path to '' as $f$
declare
  t record; v_id uuid; v_title text; v_subject text; v_status text; v_qs jsonb; v_q jsonb; v_opts jsonb;
  v_qid uuid; v_oid uuid; v_keyopt uuid; v_correct integer; v_pts integer; v_i integer; v_j integer; v_label text;
  v_pk public.ulh_packages;
begin
  select * into t from private.ulh_teacher_ctx();
  if p_package is null or jsonb_typeof(p_package) <> 'object' then raise exception 'invalid_package' using errcode = '22023'; end if;
  v_title := btrim(coalesce(p_package ->> 'title', ''));
  v_subject := btrim(coalesce(p_package ->> 'subject', ''));
  v_status := coalesce(p_package ->> 'status', 'draft');
  v_qs := coalesce(p_package -> 'questions', '[]'::jsonb);
  if char_length(v_title) not between 1 and 200 then raise exception 'invalid_title' using errcode = '22023'; end if;
  if char_length(v_subject) > 100 then raise exception 'invalid_subject' using errcode = '22023'; end if;
  if v_status not in ('draft', 'final') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if jsonb_typeof(v_qs) <> 'array' or jsonb_array_length(v_qs) > 100 then raise exception 'invalid_questions' using errcode = '22023'; end if;
  if v_status = 'final' and jsonb_array_length(v_qs) = 0 then raise exception 'final_needs_questions' using errcode = '22023'; end if;

  v_id := nullif(p_package ->> 'id', '')::uuid;
  if v_id is null then
    insert into public.ulh_packages (workspace_id, created_by, title, subject, status)
    values (t.ws, t.uid, v_title, v_subject, v_status) returning id into v_id;
    perform private.ulh_audit(t.ws, t.uid, 'package.create', 'package', v_id::text, jsonb_build_object('title', v_title));
  else
    select * into v_pk from public.ulh_packages where id = v_id and workspace_id = t.ws for update;
    if not found or not private.ulh_manages_package(v_id) then raise exception 'package_not_found' using errcode = '42501'; end if;
    if exists (select 1 from public.ulh_exams e where e.package_id = v_id and e.status <> 'draft') then
      raise exception 'package_locked' using errcode = 'P0001';
    end if;
    update public.ulh_packages set title = v_title, subject = v_subject, status = v_status where id = v_id;
    delete from public.ulh_questions where package_id = v_id;
    perform private.ulh_audit(t.ws, t.uid, 'package.update', 'package', v_id::text, jsonb_build_object('title', v_title));
  end if;

  for v_i in 0 .. jsonb_array_length(v_qs) - 1 loop
    v_q := v_qs -> v_i;
    if jsonb_typeof(v_q) <> 'object' or char_length(btrim(coalesce(v_q ->> 'body', ''))) not between 1 and 2000 then
      raise exception 'invalid_question' using errcode = '22023';
    end if;
    v_pts := coalesce((v_q ->> 'points')::integer, 1);
    if v_pts not between 1 and 100 then raise exception 'invalid_points' using errcode = '22023'; end if;
    v_opts := v_q -> 'options';
    if jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) not between 2 and 6 then
      raise exception 'invalid_options' using errcode = '22023';
    end if;
    v_correct := (v_q ->> 'correct_index')::integer;
    if v_correct is null or v_correct not between 0 and jsonb_array_length(v_opts) - 1 then
      raise exception 'invalid_correct_index' using errcode = '22023';
    end if;
    insert into public.ulh_questions (package_id, workspace_id, position, body, points)
    values (v_id, t.ws, v_i + 1, btrim(v_q ->> 'body'), v_pts) returning id into v_qid;
    for v_j in 0 .. jsonb_array_length(v_opts) - 1 loop
      v_label := case when jsonb_typeof(v_opts -> v_j) = 'string' then btrim(v_opts ->> v_j) else btrim(coalesce(v_opts -> v_j ->> 'label', '')) end;
      if char_length(v_label) not between 1 and 500 then raise exception 'invalid_option_label' using errcode = '22023'; end if;
      insert into public.ulh_options (question_id, workspace_id, position, label) values (v_qid, t.ws, v_j + 1, v_label) returning id into v_oid;
      if v_j = v_correct then v_keyopt := v_oid; end if;
    end loop;
    insert into public.ulh_question_keys (question_id, workspace_id, option_id) values (v_qid, t.ws, v_keyopt);
  end loop;
  return v_id;
end;
$f$;

create or replace function public.ulh_delete_package(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare t record;
begin
  select * into t from private.ulh_teacher_ctx();
  perform 1 from public.ulh_packages where id = p_id and workspace_id = t.ws for update;
  if not found or not private.ulh_manages_package(p_id) then
    raise exception 'package_not_found' using errcode = '42501';
  end if;
  if exists (select 1 from public.ulh_exams where package_id = p_id) then raise exception 'package_in_use' using errcode = 'P0001'; end if;
  delete from public.ulh_packages where id = p_id;
  perform private.ulh_audit(t.ws, t.uid, 'package.delete', 'package', p_id::text);
end;
$f$;

create or replace function public.ulh_list_packages() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare t record;
begin
  select * into t from private.ulh_teacher_ctx();
  return coalesce((select jsonb_agg(jsonb_build_object('id', pk.id, 'title', pk.title, 'subject', pk.subject, 'status', pk.status,
      'created_by', pk.created_by, 'updated_at', pk.updated_at,
      'question_count', (select count(*) from public.ulh_questions q where q.package_id = pk.id)) order by pk.updated_at desc)
    from public.ulh_packages pk where pk.workspace_id = t.ws and private.ulh_manages_package(pk.id)), '[]'::jsonb);
end;
$f$;

create or replace function public.ulh_get_package(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare t record; v_pk public.ulh_packages;
begin
  select * into t from private.ulh_teacher_ctx();
  select * into v_pk from public.ulh_packages where id = p_id and workspace_id = t.ws;
  if not found or not private.ulh_manages_package(p_id) then raise exception 'package_not_found' using errcode = '42501'; end if;
  return jsonb_build_object('id', v_pk.id, 'title', v_pk.title, 'subject', v_pk.subject, 'status', v_pk.status,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'body', q.body, 'points', q.points,
        'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position) from public.ulh_options o where o.question_id = q.id),
        'correct_index', (select o.position - 1 from public.ulh_options o join public.ulh_question_keys k on k.option_id = o.id where k.question_id = q.id))
        order by q.position) from public.ulh_questions q where q.package_id = v_pk.id), '[]'::jsonb));
end;
$f$;

create or replace function public.ulh_save_exam(p_exam jsonb) returns uuid
language plpgsql security definer set search_path to '' as $f$
declare
  t record; v_id uuid; v_pkg uuid; v_title text; v_dur integer; v_open timestamptz; v_close timestamptz;
  v_classes text[]; v_c text; v_sq boolean; v_so boolean; v_sr boolean; v_e public.ulh_exams;
begin
  select * into t from private.ulh_teacher_ctx();
  if p_exam is null or jsonb_typeof(p_exam) <> 'object' then raise exception 'invalid_exam' using errcode = '22023'; end if;
  v_title := btrim(coalesce(p_exam ->> 'title', ''));
  v_pkg := (p_exam ->> 'package_id')::uuid;
  v_dur := (p_exam ->> 'duration_minutes')::integer;
  v_open := (p_exam ->> 'opens_at')::timestamptz;
  v_close := (p_exam ->> 'closes_at')::timestamptz;
  v_sq := coalesce((p_exam ->> 'shuffle_questions')::boolean, true);
  v_so := coalesce((p_exam ->> 'shuffle_options')::boolean, true);
  v_sr := coalesce((p_exam ->> 'show_result')::boolean, false);
  if jsonb_typeof(p_exam -> 'class_names') is distinct from 'array' then raise exception 'invalid_classes' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct btrim(x)), '{}') into v_classes from jsonb_array_elements_text(p_exam -> 'class_names') x where btrim(x) <> '';
  if char_length(v_title) not between 1 and 200 then raise exception 'invalid_title' using errcode = '22023'; end if;
  if v_dur is null or v_dur not between 1 and 300 then raise exception 'invalid_duration' using errcode = '22023'; end if;
  if v_open is null or v_close is null or v_close <= v_open then raise exception 'invalid_schedule' using errcode = '22023'; end if;
  if coalesce(array_length(v_classes, 1), 0) not between 1 and 20 then raise exception 'invalid_classes' using errcode = '22023'; end if;
  foreach v_c in array v_classes loop
    if not exists (select 1 from public.ulh_roster s where s.workspace_id = t.ws and s.class_name = v_c) then
      raise exception 'class_not_found' using errcode = 'P0001';
    end if;
  end loop;
  if not exists (select 1 from public.ulh_packages pk where pk.id = v_pkg and pk.workspace_id = t.ws and pk.status = 'final')
     or not private.ulh_manages_package(v_pkg)
     or not exists (select 1 from public.ulh_questions q where q.package_id = v_pkg) then
    raise exception 'package_not_usable' using errcode = '42501';
  end if;

  v_id := nullif(p_exam ->> 'id', '')::uuid;
  if v_id is null then
    insert into public.ulh_exams (workspace_id, package_id, created_by, title, duration_minutes, opens_at, closes_at,
                                  shuffle_questions, shuffle_options, show_result)
    values (t.ws, v_pkg, t.uid, v_title, v_dur, v_open, v_close, v_sq, v_so, v_sr) returning id into v_id;
    perform private.ulh_audit(t.ws, t.uid, 'exam.create', 'exam', v_id::text, jsonb_build_object('title', v_title));
  else
    select * into v_e from public.ulh_exams where id = v_id and workspace_id = t.ws for update;
    if not found or not private.ulh_manages_exam(v_id) then raise exception 'exam_not_found' using errcode = '42501'; end if;
    if v_e.status <> 'draft' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
    update public.ulh_exams set package_id = v_pkg, title = v_title, duration_minutes = v_dur, opens_at = v_open, closes_at = v_close,
      shuffle_questions = v_sq, shuffle_options = v_so, show_result = v_sr where id = v_id;
    delete from public.ulh_exam_classes where exam_id = v_id;
    perform private.ulh_audit(t.ws, t.uid, 'exam.update', 'exam', v_id::text, jsonb_build_object('title', v_title));
  end if;
  insert into public.ulh_exam_classes (exam_id, workspace_id, class_name) select v_id, t.ws, unnest(v_classes);
  return v_id;
end;
$f$;

create or replace function public.ulh_publish_exam(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare t record; v_e public.ulh_exams;
begin
  select * into t from private.ulh_teacher_ctx();
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = t.ws for update;
  if not found or not private.ulh_manages_exam(p_id) then raise exception 'exam_not_found' using errcode = '42501'; end if;
  if v_e.status = 'published' then return; end if;
  if v_e.status <> 'draft' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
  if v_e.closes_at <= now() then raise exception 'schedule_in_past' using errcode = 'P0001'; end if;
  perform 1 from public.ulh_packages where id = v_e.package_id for share; -- serialisasi dengan ulh_save_package (for update)
  update public.ulh_exams set status = 'published', published_at = now() where id = p_id;
  perform private.ulh_audit(t.ws, t.uid, 'exam.publish', 'exam', p_id::text);
end;
$f$;

create or replace function public.ulh_close_exam(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare t record; v_e public.ulh_exams; r record;
begin
  select * into t from private.ulh_teacher_ctx();
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = t.ws for update;
  if not found or not private.ulh_manages_exam(p_id) then raise exception 'exam_not_found' using errcode = '42501'; end if;
  if v_e.status = 'closed' then return; end if;
  if v_e.status <> 'published' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
  update public.ulh_exams set status = 'closed', closed_at = now() where id = p_id;
  for r in select id, (expires_at <= clock_timestamp()) as late from public.ulh_attempts
           where exam_id = p_id and status = 'active' for update loop
    perform private.ulh_finalize(r.id, case when r.late then 'expired' else 'submitted' end);
  end loop;
  perform private.ulh_audit(t.ws, t.uid, 'exam.close', 'exam', p_id::text);
end;
$f$;

create or replace function public.ulh_delete_exam(p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare t record; v_e public.ulh_exams;
begin
  select * into t from private.ulh_teacher_ctx();
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = t.ws for update;
  if not found or not private.ulh_manages_exam(p_id) then raise exception 'exam_not_found' using errcode = '42501'; end if;
  if v_e.status <> 'draft' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
  delete from public.ulh_exams where id = p_id;
  perform private.ulh_audit(t.ws, t.uid, 'exam.delete', 'exam', p_id::text);
end;
$f$;

create or replace function public.ulh_list_exams() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare t record;
begin
  select * into t from private.ulh_teacher_ctx();
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'package_id', e.package_id,
      'package_title', pk.title, 'status', e.status, 'duration_minutes', e.duration_minutes, 'opens_at', e.opens_at,
      'closes_at', e.closes_at, 'shuffle_questions', e.shuffle_questions, 'shuffle_options', e.shuffle_options,
      'show_result', e.show_result,
      'class_names', (select coalesce(jsonb_agg(c.class_name order by c.class_name), '[]'::jsonb) from public.ulh_exam_classes c where c.exam_id = e.id),
      'attempt_count', (select count(*) from public.ulh_attempts a where a.exam_id = e.id)) order by e.created_at desc)
    from public.ulh_exams e join public.ulh_packages pk on pk.id = e.package_id
    where e.workspace_id = t.ws and private.ulh_manages_exam(e.id)), '[]'::jsonb);
end;
$f$;

-- Monitoring + rekap. Menutup (menilai) attempt yang waktunya sudah habis menurut jam server.
create or replace function public.ulh_exam_monitor(p_exam_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare t record; v_e public.ulh_exams; r record; v_rows jsonb; v_sum jsonb;
begin
  select * into t from private.ulh_teacher_ctx();
  select * into v_e from public.ulh_exams where id = p_exam_id and workspace_id = t.ws;
  if not found or not private.ulh_manages_exam(p_exam_id) then raise exception 'exam_not_found' using errcode = '42501'; end if;
  for r in select id from public.ulh_attempts where exam_id = p_exam_id and status = 'active' and expires_at <= clock_timestamp()
           for update skip locked loop
    perform private.ulh_finalize(r.id, 'expired');
  end loop;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.class_name, x.name), '[]'::jsonb) into v_rows from (
    select s.student_id, s.name, s.class_name, a.id as attempt_id,
           coalesce(a.status, 'not_started') as status, a.started_at, a.expires_at, a.submitted_at,
           (select count(*) from public.ulh_answers an where an.attempt_id = a.id) as answered_count,
           (select count(*) from public.ulh_attempt_questions aq where aq.attempt_id = a.id) as total_questions,
           a.score, a.max_score, a.correct_count,
           (select count(*) from public.ulh_integrity_events ev where ev.attempt_id = a.id and ev.warning_level > 0) as leave_count,
           (select coalesce(max(ev.warning_level), 0) from public.ulh_integrity_events ev where ev.attempt_id = a.id) as max_warning_level,
           (select max(ev.occurred_at) from public.ulh_integrity_events ev where ev.attempt_id = a.id) as last_event_at
    from public.ulh_roster s
    join public.ulh_exam_classes c on c.exam_id = p_exam_id and c.class_name = s.class_name
    left join public.ulh_attempts a on a.exam_id = p_exam_id and a.student_id = s.student_id
    where s.workspace_id = t.ws) x;
  select jsonb_build_object('assigned', count(*), 'started', count(*) filter (where (e ->> 'status') <> 'not_started'),
      'submitted', count(*) filter (where (e ->> 'status') in ('submitted', 'expired')),
      'avg_score', round(avg((e ->> 'score')::numeric) filter (where (e ->> 'score') is not null), 2),
      'min_score', min((e ->> 'score')::numeric), 'max_score', max((e ->> 'score')::numeric))
    into v_sum from jsonb_array_elements(v_rows) e;
  return jsonb_build_object('exam', jsonb_build_object('id', v_e.id, 'title', v_e.title, 'status', v_e.status,
      'opens_at', v_e.opens_at, 'closes_at', v_e.closes_at, 'duration_minutes', v_e.duration_minutes, 'server_now', now()),
    'summary', v_sum, 'rows', v_rows);
end;
$f$;

create or replace function public.ulh_attempt_events(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare t record;
begin
  select * into t from private.ulh_teacher_ctx();
  if not exists (select 1 from public.ulh_attempts where id = p_attempt_id and workspace_id = t.ws) or not private.ulh_manages_attempt(p_attempt_id) then
    raise exception 'attempt_not_found' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'event_type', ev.event_type, 'severity', ev.severity,
      'warning_level', ev.warning_level, 'occurred_at', ev.occurred_at, 'duration_ms', ev.duration_ms) order by ev.occurred_at)
    from public.ulh_integrity_events ev where ev.attempt_id = p_attempt_id), '[]'::jsonb);
end;
$f$;

-- ---------- RPC siswa ----------
create or replace function private.ulh_attempt_summary(p_attempt_id uuid) returns jsonb
language sql stable security definer set search_path to '' as $f$
  select jsonb_build_object('id', a.id, 'exam_id', a.exam_id, 'title', e.title, 'status', a.status, 'started_at', a.started_at,
      'expires_at', a.expires_at, 'submitted_at', a.submitted_at, 'server_now', clock_timestamp(),
      'remaining_seconds', case when a.status = 'active' then greatest(0, floor(extract(epoch from a.expires_at - clock_timestamp()))::integer) else 0 end,
      'result', case when a.status <> 'active' and e.show_result
                     then jsonb_build_object('score', a.score, 'max_score', a.max_score, 'correct_count', a.correct_count) end)
  from public.ulh_attempts a join public.ulh_exams e on e.id = a.exam_id where a.id = p_attempt_id;
$f$;

create or replace function public.ulh_list_my_exams() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare s record;
begin
  select * into s from private.ulh_student_ctx();
  return jsonb_build_object('server_now', clock_timestamp(), 'exams', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'subject', pk.subject, 'status', e.status,
        'duration_minutes', e.duration_minutes, 'opens_at', e.opens_at, 'closes_at', e.closes_at,
        'attempt', (select jsonb_build_object('id', a.id, 'status', a.status, 'submitted_at', a.submitted_at,
            'result', case when a.status <> 'active' and e.show_result
                           then jsonb_build_object('score', a.score, 'max_score', a.max_score, 'correct_count', a.correct_count) end)
          from public.ulh_attempts a where a.exam_id = e.id and a.student_id = s.student_id)) order by e.opens_at desc)
    from public.ulh_exams e
    join public.ulh_exam_classes c on c.exam_id = e.id and c.class_name = s.class_name
    join public.ulh_packages pk on pk.id = e.package_id
    where e.workspace_id = s.ws and e.status in ('published', 'closed')), '[]'::jsonb));
end;
$f$;

create or replace function public.ulh_start_attempt(p_exam_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare s record; v_e public.ulh_exams; v_id uuid; v_exp timestamptz;
begin
  select * into s from private.ulh_student_ctx();
  select e.* into v_e from public.ulh_exams e
    join public.ulh_exam_classes c on c.exam_id = e.id and c.class_name = s.class_name
    where e.id = p_exam_id and e.workspace_id = s.ws and e.status in ('published', 'closed');
  if not found then raise exception 'exam_not_available' using errcode = '42501'; end if;
  select id into v_id from public.ulh_attempts where exam_id = p_exam_id and student_id = s.student_id;
  if found then return private.ulh_attempt_summary(v_id); end if; -- idempoten: lanjutkan attempt yang sama
  if v_e.status <> 'published' or clock_timestamp() < v_e.opens_at or clock_timestamp() >= v_e.closes_at then
    raise exception 'exam_not_open' using errcode = 'P0001';
  end if;
  v_exp := least(clock_timestamp() + make_interval(mins => v_e.duration_minutes), v_e.closes_at);
  insert into public.ulh_attempts (exam_id, workspace_id, user_id, student_id, class_name, started_at, expires_at)
  values (p_exam_id, s.ws, s.uid, s.student_id, s.class_name, clock_timestamp(), v_exp)
  on conflict (exam_id, student_id) do nothing returning id into v_id;
  if v_id is null then -- balapan: panggilan lain sudah membuatnya
    select id into v_id from public.ulh_attempts where exam_id = p_exam_id and student_id = s.student_id;
    return private.ulh_attempt_summary(v_id);
  end if;
  insert into public.ulh_attempt_questions (attempt_id, question_id, workspace_id, position, option_order)
  select v_id, q.id, s.ws,
         (row_number() over (order by case when v_e.shuffle_questions then random() end, q.position))::integer,
         (select array_agg(o.id order by case when v_e.shuffle_options then random() end, o.position)
            from public.ulh_options o where o.question_id = q.id)
  from public.ulh_questions q where q.package_id = v_e.package_id;
  return private.ulh_attempt_summary(v_id);
end;
$f$;

-- Soal siswa: tanpa kunci. Soal hanya dikirim selama attempt aktif.
create or replace function public.ulh_get_attempt(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts;
begin
  -- Kepemilikan = baris attempt milik uid pemanggil (JWT). Tidak butuh keanggotaan segar: siswa yang sudah mulai bisa menyelesaikan.
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = private.current_uid() for update;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if v_a.status = 'active' and clock_timestamp() >= v_a.expires_at then perform private.ulh_finalize(p_attempt_id, 'expired'); end if;
  return jsonb_build_object('attempt', private.ulh_attempt_summary(p_attempt_id),
    'questions', case when (select status from public.ulh_attempts where id = p_attempt_id) = 'active' then coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'position', aq.position, 'body', q.body, 'points', q.points,
          'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by oo.ord)
                        from unnest(aq.option_order) with ordinality oo(oid, ord) join public.ulh_options o on o.id = oo.oid)) order by aq.position)
      from public.ulh_attempt_questions aq join public.ulh_questions q on q.id = aq.question_id
      where aq.attempt_id = p_attempt_id), '[]'::jsonb) else '[]'::jsonb end,
    'answers', coalesce((select jsonb_object_agg(an.question_id::text, an.option_id) from public.ulh_answers an where an.attempt_id = p_attempt_id), '{}'::jsonb));
end;
$f$;

-- Autosave idempoten dan monoton: client_seq lama tidak menimpa yang lebih baru. p_option_id null = hapus jawaban.
create or replace function public.ulh_save_answer(p_attempt_id uuid, p_question_id uuid, p_option_id uuid, p_client_seq bigint default 0)
returns boolean language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts; v_order uuid[]; v_rows integer;
begin
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = private.current_uid() for share;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if v_a.status <> 'active' then raise exception 'attempt_not_active' using errcode = 'P0001'; end if;
  if clock_timestamp() >= v_a.expires_at then raise exception 'attempt_expired' using errcode = 'P0001'; end if;
  select option_order into v_order from public.ulh_attempt_questions where attempt_id = p_attempt_id and question_id = p_question_id;
  if not found then raise exception 'question_not_in_attempt' using errcode = 'P0001'; end if;
  if p_option_id is null then
    delete from public.ulh_answers where attempt_id = p_attempt_id and question_id = p_question_id and client_seq <= coalesce(p_client_seq, 0);
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;
  if not (p_option_id = any (v_order)) then raise exception 'option_not_for_question' using errcode = 'P0001'; end if;
  insert into public.ulh_answers (attempt_id, question_id, workspace_id, option_id, client_seq)
  values (p_attempt_id, p_question_id, v_a.workspace_id, p_option_id, coalesce(p_client_seq, 0))
  on conflict (attempt_id, question_id) do update
    set option_id = excluded.option_id, client_seq = excluded.client_seq, updated_at = now()
    where public.ulh_answers.client_seq <= excluded.client_seq;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$f$;

-- Submit idempoten. Setelah batas waktu server: jawaban baru ditolak (ulh_save_answer), attempt ditutup
-- sebagai 'expired' dengan jawaban yang sudah tersimpan sebelum batas.
create or replace function public.ulh_submit_attempt(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts;
begin
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = private.current_uid() for update;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if v_a.status = 'active' then
    perform private.ulh_finalize(p_attempt_id, case when clock_timestamp() >= v_a.expires_at then 'expired' else 'submitted' end);
  end if;
  return private.ulh_attempt_summary(p_attempt_id);
end;
$f$;

create or replace function public.ulh_report_integrity_event(
  p_attempt_id uuid, p_client_event_id uuid, p_event_type text,
  p_occurred_at timestamptz default null, p_duration_ms integer default null, p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path to '' as $f$
declare
  v_a public.ulh_attempts; v_leave boolean; v_prev integer; v_level integer := 0; v_sev text := 'INFO'; v_rows integer; v_meta jsonb;
begin
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = private.current_uid();
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if p_event_type not in ('TAB_SWITCH', 'WINDOW_BLUR', 'VISIBILITY_LOST', 'FULLSCREEN_EXIT', 'NETWORK_LOST', 'NETWORK_RECONNECTED') then
    raise exception 'invalid_event_type' using errcode = 'P0001';
  end if;
  if v_a.status <> 'active' or clock_timestamp() >= v_a.expires_at then return jsonb_build_object('recorded', false, 'reason', 'not_active'); end if;
  if (select count(*) from public.ulh_integrity_events e where e.attempt_id = p_attempt_id and e.created_at > clock_timestamp() - interval '10 seconds') >= 20
     or (select count(*) from public.ulh_integrity_events e where e.attempt_id = p_attempt_id) >= 500 then
    return jsonb_build_object('recorded', false, 'reason', 'rate_limited');
  end if;
  v_leave := p_event_type in ('TAB_SWITCH', 'WINDOW_BLUR', 'VISIBILITY_LOST');
  -- Meninggalkan halaman baru dihitung bila > 3 detik. Peringatan bertingkat: ke-1 INFO, ke-2 WARNING, ke-3+ CRITICAL.
  -- Hanya penanda untuk guru; tidak ada tindakan otomatis terhadap siswa.
  if v_leave then
    if p_duration_ms is null or p_duration_ms <= 3000 then return jsonb_build_object('recorded', false, 'reason', 'below_threshold'); end if;
    select count(*) into v_prev from public.ulh_integrity_events e where e.attempt_id = p_attempt_id and e.warning_level > 0;
    v_level := least(v_prev + 1, 3);
    v_sev := case v_level when 1 then 'INFO' when 2 then 'WARNING' else 'CRITICAL' end;
  end if;
  v_meta := case when p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then '{}'::jsonb
                 when pg_column_size(p_metadata) > 2048 then jsonb_build_object('truncated', true) else p_metadata end;
  insert into public.ulh_integrity_events (attempt_id, workspace_id, client_event_id, event_type, severity, warning_level, occurred_at, duration_ms, metadata)
  values (p_attempt_id, v_a.workspace_id, p_client_event_id, p_event_type, v_sev, v_level,
          coalesce(least(greatest(p_occurred_at, v_a.started_at), clock_timestamp()), clock_timestamp()),
          case when p_duration_ms is null then null else greatest(0, least(p_duration_ms, 86400000)) end, v_meta)
  on conflict (attempt_id, client_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then -- retry klien: kembalikan tingkat yang sudah tercatat
    select warning_level into v_level from public.ulh_integrity_events where attempt_id = p_attempt_id and client_event_id = p_client_event_id;
  end if;
  return jsonb_build_object('recorded', v_rows > 0, 'warning_level', coalesce(v_level, 0));
end;
$f$;

-- ---------- RLS + grant: deny-by-default ----------
do $$
declare t text;
begin
  foreach t in array array['ulh_packages', 'ulh_questions', 'ulh_options', 'ulh_question_keys', 'ulh_exams', 'ulh_exam_classes',
                           'ulh_attempts', 'ulh_attempt_questions', 'ulh_answers', 'ulh_integrity_events', 'ulh_audit_log',
                           'ulh_members', 'ulh_roster'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    if t not in ('ulh_members', 'ulh_roster') then execute format('grant select on public.%I to authenticated', t); end if;
  end loop;
end $$;
-- Hanya sequence milik modul ini (jangan menyentuh sequence tabel lain: tidak ada pernyataan 'all sequences in schema').
revoke all on sequence public.ulh_audit_log_id_seq from public, anon, authenticated;

-- Hanya SELECT untuk guru. Tanpa policy insert/update/delete = klien tidak dapat menulis langsung. Siswa tanpa policy sama sekali.
create policy ulh_packages_select on public.ulh_packages for select to authenticated using ((select private.ulh_manages_package(id)));
create policy ulh_questions_select on public.ulh_questions for select to authenticated using ((select private.ulh_manages_package(package_id)));
create policy ulh_options_select on public.ulh_options for select to authenticated
  using ((select private.ulh_manages_package((select q.package_id from public.ulh_questions q where q.id = question_id))));
create policy ulh_question_keys_select on public.ulh_question_keys for select to authenticated
  using ((select private.ulh_manages_package((select q.package_id from public.ulh_questions q where q.id = question_id))));
create policy ulh_exams_select on public.ulh_exams for select to authenticated using ((select private.ulh_manages_exam(id)));
create policy ulh_exam_classes_select on public.ulh_exam_classes for select to authenticated using ((select private.ulh_manages_exam(exam_id)));
create policy ulh_attempts_select on public.ulh_attempts for select to authenticated using ((select private.ulh_manages_exam(exam_id)));
create policy ulh_attempt_questions_select on public.ulh_attempt_questions for select to authenticated using ((select private.ulh_manages_attempt(attempt_id)));
create policy ulh_answers_select on public.ulh_answers for select to authenticated using ((select private.ulh_manages_attempt(attempt_id)));
create policy ulh_integrity_events_select on public.ulh_integrity_events for select to authenticated using ((select private.ulh_manages_attempt(attempt_id)));
create policy ulh_audit_log_select on public.ulh_audit_log for select to authenticated using ((select private.ulh_is_admin_of(workspace_id)));

-- Fungsi: tutup untuk semua, buka hanya yang dipakai klien. Fungsi private dipanggil dari dalam RPC definer
-- (kecuali ulh_manages_* yang dipakai policy RLS sebagai pemanggil).
revoke all on function
  private.ulh_teacher_ctx(), private.ulh_student_ctx(), private.ulh_manages_package(uuid), private.ulh_manages_exam(uuid),
  private.ulh_manages_attempt(uuid), private.ulh_audit(text, text, text, text, text, jsonb), private.ulh_finalize(uuid, text),
  private.ulh_attempt_summary(uuid), private.ulh_is_admin_of(text)
  from public, anon, authenticated;
grant execute on function private.ulh_manages_package(uuid), private.ulh_manages_exam(uuid), private.ulh_manages_attempt(uuid), private.ulh_is_admin_of(text) to authenticated;
-- ulh_members/ulh_roster: RLS aktif TANPA policy dan TANPA grant → hanya service_role (bypass RLS) yang dapat membaca/menulis.

revoke all on function
  public.ulh_save_package(jsonb), public.ulh_delete_package(uuid), public.ulh_list_packages(), public.ulh_get_package(uuid),
  public.ulh_save_exam(jsonb), public.ulh_publish_exam(uuid), public.ulh_close_exam(uuid), public.ulh_delete_exam(uuid),
  public.ulh_list_exams(), public.ulh_exam_monitor(uuid), public.ulh_attempt_events(uuid),
  public.ulh_list_my_exams(), public.ulh_start_attempt(uuid), public.ulh_get_attempt(uuid),
  public.ulh_save_answer(uuid, uuid, uuid, bigint), public.ulh_submit_attempt(uuid),
  public.ulh_report_integrity_event(uuid, uuid, text, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.ulh_save_package(jsonb), public.ulh_delete_package(uuid), public.ulh_list_packages(), public.ulh_get_package(uuid),
  public.ulh_save_exam(jsonb), public.ulh_publish_exam(uuid), public.ulh_close_exam(uuid), public.ulh_delete_exam(uuid),
  public.ulh_list_exams(), public.ulh_exam_monitor(uuid), public.ulh_attempt_events(uuid),
  public.ulh_list_my_exams(), public.ulh_start_attempt(uuid), public.ulh_get_attempt(uuid),
  public.ulh_save_answer(uuid, uuid, uuid, bigint), public.ulh_submit_attempt(uuid),
  public.ulh_report_integrity_event(uuid, uuid, text, timestamptz, integer, jsonb)
  to authenticated;
