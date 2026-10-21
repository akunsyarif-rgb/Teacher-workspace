-- Rollback 20261009000000_rls_hardening.sql: mengembalikan definisi BASELINE (supabase/baseline/).
-- PERINGATAN: ini membuka kembali celah A–E. Pakai hanya bila migrasi menyebabkan regresi fungsional,
-- lalu terapkan perbaikan maju secepatnya. Untuk pemulihan data gunakan backup (docs/MIGRASI-SUPABASE.md).
drop function if exists public.join_workspace_by_code(text);
drop function if exists public.claim_student_profile(text);
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


create or replace function public.lookup_workspace_invite(p_code text) returns table(workspace_id text, expires_at bigint, workspace_name text, invite_code text) language sql stable security definer set search_path to '' as $function$
  select i.workspace_id, i.expires_at, w.name, w.invite_code
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.code = p_code and w.invite_code is not null
  limit 1;
$function$;

drop policy if exists workspaces_owner_insert on public.workspaces;
create policy workspaces_owner_insert on public.workspaces for insert to authenticated with check (owner_uid = (select private.current_uid()));

drop policy if exists student_profiles_self_insert on public.student_profiles;
create policy student_profiles_self_insert on public.student_profiles for insert to authenticated with check (user_id = (select private.current_uid()));
grant insert, update, delete on public.student_profiles to authenticated;

drop policy if exists submissions_student_insert on public.submissions;
create policy submissions_student_insert on public.submissions for insert to authenticated with check (
  (select private.is_own_student(workspace_id, student_id)) and status = 'menunggu_penilaian' and coalesce(feedback, '') = ''
  and (external_link is null or ((external_link ->> 'provider') = 'google-drive' and coalesce(external_link ->> 'url', '') ~ '^https://(drive|docs)[.]google[.]com(/.*)?$')));
