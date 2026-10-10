-- USULAN MIGRASI — BELUM DITERAPKAN KE PROJECT SUPABASE MANA PUN. Ditinjau lewat PR; diterapkan hanya setelah persetujuan eksplisit.
-- Diuji lokal (Postgres biasa + PostgREST), BUKAN di Supabase nyata.
--
-- Ulangan Harian Teacher Workspace (MVP): guru membuat ulangan pilihan ganda → pilih kelas & jadwal → terbit; siswa mengerjakan
-- (timer server, autosave) dan mengumpulkan; server menilai; guru melihat hasil & status.
--
-- ARSITEKTUR (mengikuti pola route server TW yang sudah ada, mis. submission-attachments):
--   browser → /api/ulangan/* (Next.js, Admin SDK memverifikasi ID token Firebase, identitas guru/siswa & kelas dibaca dari
--   Firestore = sumber kebenaran TW) → RPC di bawah dengan service_role.
-- Maka database ini TIDAK menyalin identitas/kelas dari Firestore, dan klien tidak pernah berbicara langsung ke Supabase untuk ulangan.
--   * Semua RPC: SECURITY DEFINER, search_path kosong, EXECUTE hanya untuk service_role. anon/authenticated tidak bisa memanggil.
--   * Tabel: RLS aktif tanpa policy dan tanpa grant (service_role di Workflow juga tanpa hak tabel; ia hanya memanggil RPC).
--   * Parameter aktor (workspace, uid, student_id, kelas, apakah admin) dipercaya KARENA hanya server yang bisa memanggil; server
--     menurunkannya dari token terverifikasi + Firestore, tidak dari body request.
--   * Kunci jawaban di tabel terpisah; hanya dibaca fungsi penilaian dan RPC guru.
--   * Timer: expires_at = least(mulai + durasi, penutupan) dari jam server; jawaban/submit sesudah batas ditolak.
--   * Tidak bergantung pada fungsi/tabel migrasi lain (mandiri).

-- ---------- Tabel ----------
create table public.ulh_exams (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null check (char_length(workspace_id) between 1 and 200),
  created_by text not null check (char_length(created_by) between 1 and 200),
  title text not null check (char_length(title) between 1 and 200),
  subject text not null default '' check (char_length(subject) <= 100),
  duration_minutes integer not null check (duration_minutes between 1 and 300),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  shuffle boolean not null default true,
  show_result boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index ulh_exams_ws_idx on public.ulh_exams (workspace_id, status);

create table public.ulh_exam_classes (
  exam_id uuid not null references public.ulh_exams (id) on delete cascade,
  workspace_id text not null,
  class_name text not null check (char_length(class_name) between 1 and 100),
  primary key (exam_id, class_name)
);
create index ulh_exam_classes_class_idx on public.ulh_exam_classes (workspace_id, class_name);

create table public.ulh_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.ulh_exams (id) on delete cascade,
  position integer not null check (position >= 1),
  body text not null check (char_length(body) between 1 and 2000),
  points integer not null default 1 check (points between 1 and 100),
  unique (exam_id, position)
);

create table public.ulh_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.ulh_questions (id) on delete cascade,
  position integer not null check (position >= 1),
  label text not null check (char_length(label) between 1 and 500),
  unique (question_id, position),
  unique (id, question_id)
);

-- Kunci jawaban terpisah dari soal; FK komposit memastikan opsi kunci milik soal yang sama.
create table public.ulh_question_keys (
  question_id uuid primary key references public.ulh_questions (id) on delete cascade,
  option_id uuid not null,
  foreign key (option_id, question_id) references public.ulh_options (id, question_id) on delete cascade
);

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

create table public.ulh_answers (
  attempt_id uuid not null references public.ulh_attempts (id) on delete cascade,
  question_id uuid not null references public.ulh_questions (id) on delete cascade,
  option_id uuid not null references public.ulh_options (id) on delete cascade,
  client_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

-- Kejadian integritas = INDIKASI, bukan vonis. Tingkat ditentukan server; tidak ada sanksi otomatis.
create table public.ulh_integrity_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ulh_attempts (id) on delete cascade,
  client_event_id uuid not null,
  event_type text not null check (event_type in ('TAB_SWITCH', 'WINDOW_BLUR', 'VISIBILITY_LOST', 'FULLSCREEN_EXIT', 'NETWORK_LOST', 'NETWORK_RECONNECTED')),
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  warning_level integer not null default 0 check (warning_level between 0 and 3),
  occurred_at timestamptz not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now(),
  unique (attempt_id, client_event_id)
);
create index ulh_integrity_attempt_idx on public.ulh_integrity_events (attempt_id, occurred_at);

-- updated_at dari server; workspace_id/created_at tidak boleh berubah.
create or replace function private.ulh_touch() returns trigger
language plpgsql security definer set search_path to '' as $f$
begin
  if to_jsonb(new) ? 'workspace_id' and (to_jsonb(new) ->> 'workspace_id') is distinct from (to_jsonb(old) ->> 'workspace_id') then
    raise exception 'workspace_id is immutable' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$f$;
create trigger ulh_exams_touch before update on public.ulh_exams for each row execute function private.ulh_touch();
create trigger ulh_attempts_touch before update on public.ulh_attempts for each row execute function private.ulh_touch();

-- ---------- Helper (tidak dapat dipanggil klien) ----------
-- Penilaian di server. Pemanggil memegang kunci baris attempt. Skor 0..100.
create or replace function private.ulh_finalize(p_attempt_id uuid, p_status text) returns void
language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts; v_max integer; v_earned integer; v_correct integer;
begin
  select * into v_a from public.ulh_attempts where id = p_attempt_id;
  if v_a.status <> 'active' then return; end if;
  select coalesce(sum(q.points), 0),
         coalesce(sum(q.points) filter (where k.option_id = an.option_id), 0),
         count(*) filter (where k.option_id = an.option_id)
    into v_max, v_earned, v_correct
  from public.ulh_questions q
  left join public.ulh_question_keys k on k.question_id = q.id
  left join public.ulh_answers an on an.attempt_id = p_attempt_id and an.question_id = q.id
  where q.exam_id = v_a.exam_id;
  update public.ulh_attempts
     set status = p_status,
         submitted_at = greatest(started_at, least(clock_timestamp(), expires_at)),
         score = case when v_max > 0 then round(v_earned * 100.0 / v_max, 2) else 0 end,
         max_score = v_max,
         correct_count = v_correct
   where id = p_attempt_id;
end;
$f$;

create or replace function private.ulh_attempt_summary(p_attempt_id uuid) returns jsonb
language sql stable security definer set search_path to '' as $f$
  select jsonb_build_object('id', a.id, 'exam_id', a.exam_id, 'title', e.title, 'status', a.status, 'started_at', a.started_at,
      'expires_at', a.expires_at, 'submitted_at', a.submitted_at, 'server_now', clock_timestamp(),
      'remaining_seconds', case when a.status = 'active' then greatest(0, floor(extract(epoch from a.expires_at - clock_timestamp()))::integer) else 0 end,
      'result', case when a.status <> 'active' and e.show_result
                     then jsonb_build_object('score', a.score, 'max_score', a.max_score, 'correct_count', a.correct_count) end)
  from public.ulh_attempts a join public.ulh_exams e on e.id = a.exam_id where a.id = p_attempt_id;
$f$;

-- Aktor tak boleh kosong (server selalu mengisinya dari identitas terverifikasi).
create or replace function private.ulh_need(p_a text, p_b text default 'x') returns void
language plpgsql immutable set search_path to '' as $f$
begin
  if coalesce(btrim(p_a), '') = '' or coalesce(btrim(p_b), '') = '' then raise exception 'invalid_actor' using errcode = '22023'; end if;
end;
$f$;

-- ---------- RPC guru ----------
-- Simpan ulangan (baru atau draft): metadata + kelas + soal sekaligus, atomik. Hanya draft yang bisa diubah.
-- Keberadaan kelas divalidasi server terhadap Firestore sebelum memanggil fungsi ini.
create or replace function public.ulh_save_exam(p_ws text, p_uid text, p_admin boolean, p_exam jsonb) returns uuid
language plpgsql security definer set search_path to '' as $f$
declare
  v_id uuid; v_title text; v_subject text; v_dur integer; v_open timestamptz; v_close timestamptz; v_shuffle boolean; v_show boolean;
  v_classes text[]; v_qs jsonb; v_q jsonb; v_opts jsonb; v_qid uuid; v_oid uuid; v_keyopt uuid; v_correct integer; v_pts integer;
  v_i integer; v_j integer; v_label text; v_e public.ulh_exams;
begin
  perform private.ulh_need(p_ws, p_uid);
  if p_exam is null or jsonb_typeof(p_exam) <> 'object' then raise exception 'invalid_exam' using errcode = '22023'; end if;
  v_title := btrim(coalesce(p_exam ->> 'title', ''));
  v_subject := btrim(coalesce(p_exam ->> 'subject', ''));
  v_dur := (p_exam ->> 'duration_minutes')::integer;
  v_open := (p_exam ->> 'opens_at')::timestamptz;
  v_close := (p_exam ->> 'closes_at')::timestamptz;
  v_shuffle := coalesce((p_exam ->> 'shuffle')::boolean, true);
  v_show := coalesce((p_exam ->> 'show_result')::boolean, false);
  v_qs := coalesce(p_exam -> 'questions', '[]'::jsonb);
  if char_length(v_title) not between 1 and 200 then raise exception 'invalid_title' using errcode = '22023'; end if;
  if char_length(v_subject) > 100 then raise exception 'invalid_subject' using errcode = '22023'; end if;
  if v_dur is null or v_dur not between 1 and 300 then raise exception 'invalid_duration' using errcode = '22023'; end if;
  if v_open is null or v_close is null or v_close <= v_open then raise exception 'invalid_schedule' using errcode = '22023'; end if;
  if jsonb_typeof(p_exam -> 'class_names') is distinct from 'array' then raise exception 'invalid_classes' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct btrim(x)), '{}') into v_classes from jsonb_array_elements_text(p_exam -> 'class_names') x where btrim(x) <> '';
  if coalesce(array_length(v_classes, 1), 0) not between 1 and 20 then raise exception 'invalid_classes' using errcode = '22023'; end if;
  if jsonb_typeof(v_qs) <> 'array' or jsonb_array_length(v_qs) not between 1 and 100 then raise exception 'invalid_questions' using errcode = '22023'; end if;

  v_id := nullif(p_exam ->> 'id', '')::uuid;
  if v_id is null then
    insert into public.ulh_exams (workspace_id, created_by, title, subject, duration_minutes, opens_at, closes_at, shuffle, show_result)
    values (p_ws, p_uid, v_title, v_subject, v_dur, v_open, v_close, v_shuffle, v_show) returning id into v_id;
  else
    select * into v_e from public.ulh_exams where id = v_id and workspace_id = p_ws and (created_by = p_uid or p_admin) for update;
    if not found then raise exception 'exam_not_found' using errcode = '42501'; end if;
    if v_e.status <> 'draft' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
    update public.ulh_exams set title = v_title, subject = v_subject, duration_minutes = v_dur, opens_at = v_open, closes_at = v_close,
      shuffle = v_shuffle, show_result = v_show where id = v_id;
    delete from public.ulh_exam_classes where exam_id = v_id;
    delete from public.ulh_questions where exam_id = v_id; -- opsi & kunci ikut terhapus (cascade)
  end if;
  insert into public.ulh_exam_classes (exam_id, workspace_id, class_name) select v_id, p_ws, unnest(v_classes);

  for v_i in 0 .. jsonb_array_length(v_qs) - 1 loop
    v_q := v_qs -> v_i;
    if jsonb_typeof(v_q) <> 'object' or char_length(btrim(coalesce(v_q ->> 'body', ''))) not between 1 and 2000 then
      raise exception 'invalid_question' using errcode = '22023';
    end if;
    v_pts := coalesce((v_q ->> 'points')::integer, 1);
    if v_pts not between 1 and 100 then raise exception 'invalid_points' using errcode = '22023'; end if;
    v_opts := v_q -> 'options';
    if jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) not between 2 and 6 then raise exception 'invalid_options' using errcode = '22023'; end if;
    v_correct := (v_q ->> 'correct_index')::integer;
    if v_correct is null or v_correct not between 0 and jsonb_array_length(v_opts) - 1 then raise exception 'invalid_correct_index' using errcode = '22023'; end if;
    insert into public.ulh_questions (exam_id, position, body, points) values (v_id, v_i + 1, btrim(v_q ->> 'body'), v_pts) returning id into v_qid;
    for v_j in 0 .. jsonb_array_length(v_opts) - 1 loop
      v_label := case when jsonb_typeof(v_opts -> v_j) = 'string' then btrim(v_opts ->> v_j) else btrim(coalesce(v_opts -> v_j ->> 'label', '')) end;
      if char_length(v_label) not between 1 and 500 then raise exception 'invalid_option_label' using errcode = '22023'; end if;
      insert into public.ulh_options (question_id, position, label) values (v_qid, v_j + 1, v_label) returning id into v_oid;
      if v_j = v_correct then v_keyopt := v_oid; end if;
    end loop;
    insert into public.ulh_question_keys (question_id, option_id) values (v_qid, v_keyopt);
  end loop;
  return v_id;
end;
$f$;

-- Ulangan lengkap untuk diedit guru (termasuk kunci). Hanya pembuat atau admin workspace.
create or replace function public.ulh_get_exam(p_ws text, p_uid text, p_admin boolean, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare v_e public.ulh_exams;
begin
  perform private.ulh_need(p_ws, p_uid);
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = p_ws and (created_by = p_uid or p_admin);
  if not found then raise exception 'exam_not_found' using errcode = '42501'; end if;
  return jsonb_build_object('id', v_e.id, 'title', v_e.title, 'subject', v_e.subject, 'status', v_e.status,
    'duration_minutes', v_e.duration_minutes, 'opens_at', v_e.opens_at, 'closes_at', v_e.closes_at, 'shuffle', v_e.shuffle, 'show_result', v_e.show_result,
    'class_names', (select coalesce(jsonb_agg(c.class_name order by c.class_name), '[]'::jsonb) from public.ulh_exam_classes c where c.exam_id = v_e.id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'body', q.body, 'points', q.points,
        'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position) from public.ulh_options o where o.question_id = q.id),
        'correct_index', (select o.position - 1 from public.ulh_options o join public.ulh_question_keys k on k.option_id = o.id where k.question_id = q.id))
        order by q.position) from public.ulh_questions q where q.exam_id = v_e.id), '[]'::jsonb));
end;
$f$;

create or replace function public.ulh_list_exams(p_ws text, p_uid text, p_admin boolean) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.ulh_need(p_ws, p_uid);
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'subject', e.subject, 'status', e.status,
      'duration_minutes', e.duration_minutes, 'opens_at', e.opens_at, 'closes_at', e.closes_at, 'show_result', e.show_result,
      'class_names', (select coalesce(jsonb_agg(c.class_name order by c.class_name), '[]'::jsonb) from public.ulh_exam_classes c where c.exam_id = e.id),
      'question_count', (select count(*) from public.ulh_questions q where q.exam_id = e.id),
      'attempt_count', (select count(*) from public.ulh_attempts a where a.exam_id = e.id)) order by e.created_at desc)
    from public.ulh_exams e where e.workspace_id = p_ws and (e.created_by = p_uid or p_admin)), '[]'::jsonb);
end;
$f$;

create or replace function public.ulh_publish_exam(p_ws text, p_uid text, p_admin boolean, p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare v_e public.ulh_exams;
begin
  perform private.ulh_need(p_ws, p_uid);
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = p_ws and (created_by = p_uid or p_admin) for update;
  if not found then raise exception 'exam_not_found' using errcode = '42501'; end if;
  if v_e.status = 'published' then return; end if;
  if v_e.status <> 'draft' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
  if v_e.closes_at <= now() then raise exception 'schedule_in_past' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.ulh_questions where exam_id = p_id) then raise exception 'exam_needs_questions' using errcode = 'P0001'; end if;
  update public.ulh_exams set status = 'published', published_at = now() where id = p_id;
end;
$f$;

-- Tutup ulangan: pengerjaan yang masih berjalan dinilai & dikumpulkan.
create or replace function public.ulh_close_exam(p_ws text, p_uid text, p_admin boolean, p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare v_e public.ulh_exams; r record;
begin
  perform private.ulh_need(p_ws, p_uid);
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = p_ws and (created_by = p_uid or p_admin) for update;
  if not found then raise exception 'exam_not_found' using errcode = '42501'; end if;
  if v_e.status = 'closed' then return; end if;
  if v_e.status <> 'published' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
  update public.ulh_exams set status = 'closed', closed_at = now() where id = p_id;
  for r in select id, (expires_at <= clock_timestamp()) as late from public.ulh_attempts where exam_id = p_id and status = 'active' for update loop
    perform private.ulh_finalize(r.id, case when r.late then 'expired' else 'submitted' end);
  end loop;
end;
$f$;

create or replace function public.ulh_delete_exam(p_ws text, p_uid text, p_admin boolean, p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare v_e public.ulh_exams;
begin
  perform private.ulh_need(p_ws, p_uid);
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = p_ws and (created_by = p_uid or p_admin) for update;
  if not found then raise exception 'exam_not_found' using errcode = '42501'; end if;
  if v_e.status <> 'draft' then raise exception 'exam_locked' using errcode = 'P0001'; end if;
  delete from public.ulh_exams where id = p_id;
end;
$f$;

-- Hasil & status pengerjaan. Menutup (menilai) pengerjaan yang waktunya sudah habis menurut jam server.
-- Daftar siswa kelas (termasuk yang belum mulai) dan nama dilengkapi server dari Firestore; di sini hanya data attempt.
create or replace function public.ulh_exam_results(p_ws text, p_uid text, p_admin boolean, p_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare v_e public.ulh_exams; r record; v_rows jsonb;
begin
  perform private.ulh_need(p_ws, p_uid);
  select * into v_e from public.ulh_exams where id = p_id and workspace_id = p_ws and (created_by = p_uid or p_admin);
  if not found then raise exception 'exam_not_found' using errcode = '42501'; end if;
  for r in select id from public.ulh_attempts where exam_id = p_id and status = 'active' and expires_at <= clock_timestamp() for update skip locked loop
    perform private.ulh_finalize(r.id, 'expired');
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('attempt_id', a.id, 'student_id', a.student_id, 'class_name', a.class_name, 'status', a.status,
      'started_at', a.started_at, 'expires_at', a.expires_at, 'submitted_at', a.submitted_at,
      'answered_count', (select count(*) from public.ulh_answers an where an.attempt_id = a.id),
      'score', a.score, 'max_score', a.max_score, 'correct_count', a.correct_count,
      'leave_count', (select count(*) from public.ulh_integrity_events ev where ev.attempt_id = a.id and ev.warning_level > 0),
      'max_warning_level', (select coalesce(max(ev.warning_level), 0) from public.ulh_integrity_events ev where ev.attempt_id = a.id),
      'last_event_at', (select max(ev.occurred_at) from public.ulh_integrity_events ev where ev.attempt_id = a.id)) order by a.class_name, a.started_at), '[]'::jsonb)
    into v_rows from public.ulh_attempts a where a.exam_id = p_id;
  return jsonb_build_object('exam', jsonb_build_object('id', v_e.id, 'title', v_e.title, 'status', v_e.status, 'opens_at', v_e.opens_at,
      'closes_at', v_e.closes_at, 'duration_minutes', v_e.duration_minutes, 'server_now', now(),
      'class_names', (select coalesce(jsonb_agg(c.class_name order by c.class_name), '[]'::jsonb) from public.ulh_exam_classes c where c.exam_id = v_e.id),
      'question_count', (select count(*) from public.ulh_questions q where q.exam_id = v_e.id)),
    'attempts', v_rows);
end;
$f$;

create or replace function public.ulh_attempt_events(p_ws text, p_uid text, p_admin boolean, p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.ulh_need(p_ws, p_uid);
  if not exists (select 1 from public.ulh_attempts a join public.ulh_exams e on e.id = a.exam_id
                 where a.id = p_attempt_id and e.workspace_id = p_ws and (e.created_by = p_uid or p_admin)) then
    raise exception 'attempt_not_found' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'event_type', ev.event_type, 'severity', ev.severity,
      'warning_level', ev.warning_level, 'occurred_at', ev.occurred_at, 'duration_ms', ev.duration_ms) order by ev.occurred_at)
    from public.ulh_integrity_events ev where ev.attempt_id = p_attempt_id), '[]'::jsonb);
end;
$f$;

-- ---------- RPC siswa (server memberi p_student_id & p_class dari Firestore; attempt-level dikunci pada uid) ----------
create or replace function public.ulh_list_student_exams(p_ws text, p_student_id text, p_class text) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.ulh_need(p_ws, p_student_id);
  perform private.ulh_need(p_class);
  return jsonb_build_object('server_now', clock_timestamp(), 'exams', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'subject', e.subject, 'status', e.status,
        'duration_minutes', e.duration_minutes, 'opens_at', e.opens_at, 'closes_at', e.closes_at,
        'attempt', (select jsonb_build_object('id', a.id, 'status', a.status,
            'result', case when a.status <> 'active' and e.show_result
                           then jsonb_build_object('score', a.score, 'max_score', a.max_score, 'correct_count', a.correct_count) end)
          from public.ulh_attempts a where a.exam_id = e.id and a.student_id = p_student_id)) order by e.opens_at desc)
    from public.ulh_exams e join public.ulh_exam_classes c on c.exam_id = e.id and c.class_name = p_class
    where e.workspace_id = p_ws and e.status in ('published', 'closed')), '[]'::jsonb));
end;
$f$;

-- Mulai / lanjutkan. Idempoten. Bila siswa yang sama masuk dari perangkat/sesi anonim baru, pengerjaan AKTIF dialihkan ke uid baru
-- (sesi lama kehilangan akses) — identitas siswa sudah diverifikasi server dari Firestore.
create or replace function public.ulh_start_attempt(p_ws text, p_uid text, p_student_id text, p_class text, p_exam_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare v_e public.ulh_exams; v_a public.ulh_attempts; v_id uuid;
begin
  perform private.ulh_need(p_ws, p_uid);
  perform private.ulh_need(p_student_id, p_class);
  select e.* into v_e from public.ulh_exams e join public.ulh_exam_classes c on c.exam_id = e.id and c.class_name = p_class
    where e.id = p_exam_id and e.workspace_id = p_ws and e.status in ('published', 'closed');
  if not found then raise exception 'exam_not_available' using errcode = '42501'; end if;
  select * into v_a from public.ulh_attempts where exam_id = p_exam_id and student_id = p_student_id for update;
  if found then
    if v_a.status = 'active' and v_a.user_id <> p_uid then update public.ulh_attempts set user_id = p_uid where id = v_a.id; end if;
    return private.ulh_attempt_summary(v_a.id);
  end if;
  if v_e.status <> 'published' or clock_timestamp() < v_e.opens_at or clock_timestamp() >= v_e.closes_at then
    raise exception 'exam_not_open' using errcode = 'P0001';
  end if;
  insert into public.ulh_attempts (exam_id, workspace_id, user_id, student_id, class_name, started_at, expires_at)
  values (p_exam_id, p_ws, p_uid, p_student_id, p_class, clock_timestamp(),
          least(clock_timestamp() + make_interval(mins => v_e.duration_minutes), v_e.closes_at))
  on conflict (exam_id, student_id) do nothing returning id into v_id;
  if v_id is null then -- balapan: panggilan lain sudah membuatnya
    select id into v_id from public.ulh_attempts where exam_id = p_exam_id and student_id = p_student_id;
  end if;
  return private.ulh_attempt_summary(v_id);
end;
$f$;

-- Soal siswa: tanpa kunci; hanya selama attempt aktif. Urutan acak (jika diaktifkan) stabil per attempt (hash id attempt+soal/opsi).
create or replace function public.ulh_get_attempt(p_uid text, p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts; v_e public.ulh_exams;
begin
  perform private.ulh_need(p_uid);
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = p_uid for update;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if v_a.status = 'active' and clock_timestamp() >= v_a.expires_at then perform private.ulh_finalize(p_attempt_id, 'expired'); end if;
  select * into v_e from public.ulh_exams where id = v_a.exam_id;
  return jsonb_build_object('attempt', private.ulh_attempt_summary(p_attempt_id),
    'questions', case when (select status from public.ulh_attempts where id = p_attempt_id) = 'active' then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'position', x.pos, 'body', x.body, 'points', x.points,
          'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label)
                        order by case when v_e.shuffle then md5(p_attempt_id::text || o.id::text) end, o.position)
                      from public.ulh_options o where o.question_id = x.id)) order by x.pos)
      from (select q.id, q.body, q.points,
                   (row_number() over (order by case when v_e.shuffle then md5(p_attempt_id::text || q.id::text) end, q.position))::integer as pos
              from public.ulh_questions q where q.exam_id = v_a.exam_id) x), '[]'::jsonb) else '[]'::jsonb end,
    'answers', coalesce((select jsonb_object_agg(an.question_id::text, an.option_id) from public.ulh_answers an where an.attempt_id = p_attempt_id), '{}'::jsonb));
end;
$f$;

-- Autosave idempoten dan monoton: client_seq lama tidak menimpa yang lebih baru. p_option_id null = hapus jawaban.
create or replace function public.ulh_save_answer(p_uid text, p_attempt_id uuid, p_question_id uuid, p_option_id uuid, p_client_seq bigint default 0)
returns boolean language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts; v_rows integer;
begin
  perform private.ulh_need(p_uid);
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = p_uid for share;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if v_a.status <> 'active' then raise exception 'attempt_not_active' using errcode = 'P0001'; end if;
  if clock_timestamp() >= v_a.expires_at then raise exception 'attempt_expired' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.ulh_questions q where q.id = p_question_id and q.exam_id = v_a.exam_id) then
    raise exception 'question_not_in_attempt' using errcode = 'P0001';
  end if;
  if p_option_id is null then
    delete from public.ulh_answers where attempt_id = p_attempt_id and question_id = p_question_id and client_seq <= coalesce(p_client_seq, 0);
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;
  if not exists (select 1 from public.ulh_options o where o.id = p_option_id and o.question_id = p_question_id) then
    raise exception 'option_not_for_question' using errcode = 'P0001';
  end if;
  insert into public.ulh_answers (attempt_id, question_id, option_id, client_seq)
  values (p_attempt_id, p_question_id, p_option_id, coalesce(p_client_seq, 0))
  on conflict (attempt_id, question_id) do update
    set option_id = excluded.option_id, client_seq = excluded.client_seq, updated_at = now()
    where public.ulh_answers.client_seq <= excluded.client_seq;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$f$;

-- Submit idempoten. Sesudah batas waktu server: jawaban baru ditolak (ulh_save_answer); attempt ditutup 'expired' dengan jawaban tersimpan.
create or replace function public.ulh_submit_attempt(p_uid text, p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts;
begin
  perform private.ulh_need(p_uid);
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = p_uid for update;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if v_a.status = 'active' then
    perform private.ulh_finalize(p_attempt_id, case when clock_timestamp() >= v_a.expires_at then 'expired' else 'submitted' end);
  end if;
  return private.ulh_attempt_summary(p_attempt_id);
end;
$f$;

-- Peringatan integritas: hanya jeda > 3 detik yang dihitung; tingkat 1/2/3 ditentukan server; tanpa sanksi otomatis.
create or replace function public.ulh_report_integrity_event(
  p_uid text, p_attempt_id uuid, p_client_event_id uuid, p_event_type text,
  p_occurred_at timestamptz default null, p_duration_ms integer default null, p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path to '' as $f$
declare v_a public.ulh_attempts; v_prev integer; v_level integer := 0; v_sev text := 'INFO'; v_rows integer; v_meta jsonb;
begin
  perform private.ulh_need(p_uid);
  select * into v_a from public.ulh_attempts where id = p_attempt_id and user_id = p_uid;
  if not found then raise exception 'attempt_not_found' using errcode = '42501'; end if;
  if p_event_type not in ('TAB_SWITCH', 'WINDOW_BLUR', 'VISIBILITY_LOST', 'FULLSCREEN_EXIT', 'NETWORK_LOST', 'NETWORK_RECONNECTED') then
    raise exception 'invalid_event_type' using errcode = 'P0001';
  end if;
  if v_a.status <> 'active' or clock_timestamp() >= v_a.expires_at then return jsonb_build_object('recorded', false, 'reason', 'not_active'); end if;
  if (select count(*) from public.ulh_integrity_events e where e.attempt_id = p_attempt_id and e.created_at > clock_timestamp() - interval '10 seconds') >= 20
     or (select count(*) from public.ulh_integrity_events e where e.attempt_id = p_attempt_id) >= 500 then
    return jsonb_build_object('recorded', false, 'reason', 'rate_limited');
  end if;
  if p_event_type in ('TAB_SWITCH', 'WINDOW_BLUR', 'VISIBILITY_LOST') then
    if p_duration_ms is null or p_duration_ms <= 3000 then return jsonb_build_object('recorded', false, 'reason', 'below_threshold'); end if;
    select count(*) into v_prev from public.ulh_integrity_events e where e.attempt_id = p_attempt_id and e.warning_level > 0;
    v_level := least(v_prev + 1, 3);
    v_sev := case v_level when 1 then 'INFO' when 2 then 'WARNING' else 'CRITICAL' end;
  end if;
  v_meta := case when p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then '{}'::jsonb
                 when pg_column_size(p_metadata) > 2048 then jsonb_build_object('truncated', true) else p_metadata end;
  insert into public.ulh_integrity_events (attempt_id, client_event_id, event_type, severity, warning_level, occurred_at, duration_ms, metadata)
  values (p_attempt_id, p_client_event_id, p_event_type, v_sev, v_level,
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

-- ---------- Akses: deny-by-default ----------
do $$
declare t text;
begin
  foreach t in array array['ulh_exams', 'ulh_exam_classes', 'ulh_questions', 'ulh_options', 'ulh_question_keys', 'ulh_attempts', 'ulh_answers', 'ulh_integrity_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Semua fungsi: tutup untuk semua, buka HANYA untuk service_role (server Next.js). Tidak ada grant tabel: RPC berjalan sebagai pemilik (definer).
revoke all on function
  private.ulh_touch(), private.ulh_finalize(uuid, text), private.ulh_attempt_summary(uuid), private.ulh_need(text, text),
  public.ulh_save_exam(text, text, boolean, jsonb), public.ulh_get_exam(text, text, boolean, uuid), public.ulh_list_exams(text, text, boolean),
  public.ulh_publish_exam(text, text, boolean, uuid), public.ulh_close_exam(text, text, boolean, uuid), public.ulh_delete_exam(text, text, boolean, uuid),
  public.ulh_exam_results(text, text, boolean, uuid), public.ulh_attempt_events(text, text, boolean, uuid),
  public.ulh_list_student_exams(text, text, text), public.ulh_start_attempt(text, text, text, text, uuid), public.ulh_get_attempt(text, uuid),
  public.ulh_save_answer(text, uuid, uuid, uuid, bigint), public.ulh_submit_attempt(text, uuid),
  public.ulh_report_integrity_event(text, uuid, uuid, text, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.ulh_save_exam(text, text, boolean, jsonb), public.ulh_get_exam(text, text, boolean, uuid), public.ulh_list_exams(text, text, boolean),
  public.ulh_publish_exam(text, text, boolean, uuid), public.ulh_close_exam(text, text, boolean, uuid), public.ulh_delete_exam(text, text, boolean, uuid),
  public.ulh_exam_results(text, text, boolean, uuid), public.ulh_attempt_events(text, text, boolean, uuid),
  public.ulh_list_student_exams(text, text, text), public.ulh_start_attempt(text, text, text, text, uuid), public.ulh_get_attempt(text, uuid),
  public.ulh_save_answer(text, uuid, uuid, uuid, bigint), public.ulh_submit_attempt(text, uuid),
  public.ulh_report_integrity_event(text, uuid, uuid, text, timestamptz, integer, jsonb)
  to service_role;
