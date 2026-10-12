-- Menutup celah: baris teacher_profiles dengan role NULL tetapi workspace_id terisi dianggap guru
-- oleh private.is_teacher_workspace (hanya memeriksa workspace_id). can_claim_role(NULL, ws) dulu
-- bernilai true untuk workspace mana pun, sehingga INSERT (policy teacher_profiles_self_insert) atau
-- UPDATE dari baris tanpa workspace (guard_teacher_profile_update) bisa menempelkan akun ke workspace
-- orang lain tanpa kode undangan. Role NULL kini hanya sah bila workspace_id juga NULL.
-- Bergabung sebagai TEACHER tetap hanya lewat public.join_workspace_by_code (SECURITY DEFINER).
-- Idempoten. Rollback: supabase/rollback/20261011000000_teacher_profile_null_role_fix_down.sql
create or replace function private.can_claim_role(p_role text, p_workspace_id text)
returns boolean language sql stable security definer set search_path to '' as $function$
  select case
    when p_role is null then p_workspace_id is null
    when p_workspace_id is null then false
    when p_role = 'OWNER' then exists (
      select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_uid = private.current_uid())
    else false end;
$function$;
