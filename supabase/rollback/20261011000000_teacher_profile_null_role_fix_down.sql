-- Rollback 20261011000000_teacher_profile_null_role_fix.sql (mengembalikan perilaku 20261009000000, CELAH TERBUKA LAGI)
create or replace function private.can_claim_role(p_role text, p_workspace_id text)
returns boolean language sql stable security definer set search_path to '' as $function$
  select case
    when p_role is null then true
    when p_workspace_id is null then false
    when p_role = 'OWNER' then exists (
      select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_uid = private.current_uid())
    else false end;
$function$;
