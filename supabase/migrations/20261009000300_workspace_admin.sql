-- Menu Admin sekolah (hanya pemilik workspace): mengeluarkan guru dari workspace.
-- SECURITY DEFINER karena klien tidak boleh mengubah profil guru lain (policy self_update); izin dicek ulang di sini,
-- bukan dipercaya dari klien. Tidak menghapus akun maupun data yang sudah dibuat guru; guru bisa bergabung lagi lewat
-- public.join_workspace_by_code. Tidak ada kaitan pembayaran/langganan.
create or replace function public.remove_workspace_member(p_target text) returns void
language plpgsql security definer set search_path to '' as $function$
declare
  v_uid text := private.current_uid();
  v_ws text;
  v_role text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if coalesce(p_target, '') = '' then raise exception 'target required' using errcode = '22023'; end if;
  select tp.workspace_id, tp.role into v_ws, v_role from public.teacher_profiles tp where tp.user_id = p_target;
  if not found or v_ws is null then raise exception 'member not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.workspaces w where w.id = v_ws and w.owner_uid = v_uid) then
    raise exception 'only the workspace owner may remove members' using errcode = '42501';
  end if;
  if p_target = v_uid then raise exception 'owner cannot remove self' using errcode = 'P0001'; end if;
  if v_role = 'OWNER' then raise exception 'workspace owner cannot be removed' using errcode = 'P0001'; end if;
  update public.teacher_profiles set workspace_id = null, role = null, homeroom_class_name = null where user_id = p_target;
end;
$function$;
revoke all on function public.remove_workspace_member(text) from public, anon;
grant execute on function public.remove_workspace_member(text) to authenticated;
