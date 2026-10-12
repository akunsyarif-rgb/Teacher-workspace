-- BASELINE (lihat 001_schema.sql). Definisi fungsi disalin apa adanya dari
-- pg_get_functiondef produksi.

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path to '' as $function$
begin
  if (select auth.role()) = 'service_role' and new.updated_at is distinct from old.updated_at then
    return new;  -- import: keep original Firestore timestamp
  end if;
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function private.current_uid() returns text language sql stable set search_path to '' as
$function$ select nullif(auth.jwt() ->> 'sub', '') $function$;

create or replace function private.can_claim_role(p_role text, p_workspace_id text) returns boolean language sql stable security definer set search_path to '' as $function$
  select case
    when p_role is null then true
    when p_workspace_id is null then false
    when p_role = 'TEACHER' then exists (
      select 1 from public.workspaces w where w.id = p_workspace_id
        and w.invite_code is not null
        and w.invite_code_expires_at > (extract(epoch from now()) * 1000)::bigint)
    when p_role = 'OWNER' then exists (
      select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_uid = private.current_uid())
    else false end;
$function$;

create or replace function private.is_homeroom_of(p_workspace_id text, p_class_name text) returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.teacher_profiles tp
    where tp.user_id = private.current_uid()
      and tp.workspace_id = p_workspace_id
      and tp.homeroom_class_name = p_class_name);
$function$;

create or replace function private.is_own_student(p_workspace_id text, p_student_id text) returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.student_profiles sp where sp.user_id=private.current_uid() and sp.workspace_id=p_workspace_id and sp.student_id=p_student_id);
$function$;

create or replace function private.is_student_class(p_workspace_id text, p_class_name text) returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.student_profiles sp where sp.user_id=private.current_uid() and sp.workspace_id=p_workspace_id and sp.class_name=p_class_name);
$function$;

create or replace function private.is_student_workspace(p_workspace_id text) returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.student_profiles sp where sp.user_id=private.current_uid() and sp.workspace_id=p_workspace_id);
$function$;

create or replace function private.is_teacher_admin_or_owner(p_workspace_id text) returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.teacher_profiles tp where tp.user_id=private.current_uid() and tp.workspace_id=p_workspace_id and tp.role in ('OWNER','ADMIN'));
$function$;

create or replace function private.is_teacher_workspace(p_workspace_id text) returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.teacher_profiles tp where tp.user_id=private.current_uid() and tp.workspace_id=p_workspace_id);
$function$;

create or replace function private.is_workspace_owner(p_workspace_id text) returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.workspaces w where w.id=p_workspace_id and w.owner_uid=private.current_uid());
$function$;

create or replace function private.plan_fields_unchanged(p_workspace_id text, p_plan text, p_class_limit integer, p_seat_limit integer, p_plan_expires_at bigint) returns boolean language sql stable security definer set search_path to '' as
$function$ select exists(select 1 from public.workspaces w where w.id=p_workspace_id and w.plan is not distinct from p_plan and w.class_limit is not distinct from p_class_limit and w.seat_limit is not distinct from p_seat_limit and w.plan_expires_at is not distinct from p_plan_expires_at); $function$;

create or replace function private.protect_immutable_columns() returns trigger language plpgsql set search_path to '' as $function$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;
  new.created_at = old.created_at;
  if to_jsonb(new) ? 'workspace_id' and (to_jsonb(new) ->> 'workspace_id') is distinct from (to_jsonb(old) ->> 'workspace_id') then
    raise exception 'workspace_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function private.guard_teacher_profile_update() returns trigger language plpgsql set search_path to '' as $function$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  if new.user_id is distinct from old.user_id then raise exception 'user_id is immutable' using errcode = '42501'; end if;
  if new.workspace_id is distinct from old.workspace_id or new.role is distinct from old.role then
    if not (old.workspace_id is null and private.can_claim_role(new.role, new.workspace_id)) then
      raise exception 'workspace/role change not allowed' using errcode = '42501';
    end if;
  end if;
  if new.homeroom_class_name is distinct from old.homeroom_class_name
     and coalesce(old.role, '') not in ('OWNER', 'ADMIN') then
    raise exception 'homeroom change not allowed' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function private.guard_student_submission_update() returns trigger language plpgsql set search_path to '' as $function$
declare had_work boolean;
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  if (select private.is_teacher_workspace(old.workspace_id)) then return new; end if;
  if new.student_id is distinct from old.student_id or new.assignment_id is distinct from old.assignment_id then
    raise exception 'submission ids are immutable' using errcode = '42501';
  end if;
  had_work := old.submitted_at is not null or coalesce(old.text_answer, '') <> ''
    or old.external_link is not null or coalesce(jsonb_array_length(old.attachments), 0) > 0;
  if old.status = 'dinilai' and had_work then
    raise exception 'submission locked after grading' using errcode = '42501';
  end if;
  new.feedback := old.feedback;
  new.score := old.score;
  return new;
end;
$function$;

create or replace function public."current_role"() returns text language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select lower(tp.role) from public.teacher_profiles tp where tp.user_id = (auth.jwt()->>'sub') limit 1),
    case when exists (
      select 1 from public.student_profiles sp where sp.user_id = (auth.jwt()->>'sub')
    ) then 'student' end
  );
$function$;

create or replace function public.current_workspace_id() returns text language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select tp.workspace_id from public.teacher_profiles tp where tp.user_id = (auth.jwt()->>'sub') limit 1),
    (select sp.workspace_id from public.student_profiles sp where sp.user_id = (auth.jwt()->>'sub') limit 1)
  );
$function$;

create or replace function public.is_admin_or_owner() returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public.current_role() in ('owner','admin');
$function$;

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path to 'public' as $function$
  select public.current_role() in ('owner','admin','teacher');
$function$;

create or replace function public.is_workspace_member(target_workspace_id text) returns boolean language sql stable security definer set search_path to 'public' as $function$
  select target_workspace_id is not null and target_workspace_id = public.current_workspace_id();
$function$;

create or replace function public.claim_student_login_code(p_code text) returns table(student_id text, workspace_id text, name text, class_name text, nis text) language sql security definer set search_path to '' as $function$
  select c.student_id,c.workspace_id,c.name,c.class_name,coalesce(c.nis,'-') from public.student_login_codes c where c.id=p_code limit 1;
$function$;

create or replace function public.lookup_workspace_invite(p_code text) returns table(workspace_id text, expires_at bigint, workspace_name text, invite_code text) language sql stable security definer set search_path to '' as $function$
  select i.workspace_id, i.expires_at, w.name, w.invite_code
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.code = p_code and w.invite_code is not null
  limit 1;
$function$;

-- Trigger (pola sama dengan produksi)
do $$
declare t text;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' loop
    execute format('create trigger trg_%s_updated_at before update on public.%I for each row execute function set_updated_at()', t, t);
    if t <> 'teacher_profiles' then
      execute format('create trigger trg_protect_immutable before update on public.%I for each row execute function private.protect_immutable_columns()', t);
    end if;
  end loop;
end $$;
create trigger trg_guard_student_submission before update on public.submissions for each row execute function private.guard_student_submission_update();
create trigger trg_guard_teacher_profile before update on public.teacher_profiles for each row execute function private.guard_teacher_profile_update();
