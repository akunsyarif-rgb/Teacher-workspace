-- USULAN MIGRASI — BELUM DITERAPKAN KE PRODUKSI. Ditinjau lewat PR; diterapkan
-- hanya setelah persetujuan eksplisit pemilik. Diuji lokal terhadap baseline
-- (tests/rls-parity.test.ts). Menutup celah yang terbukti di baseline:
--   A. lookup_workspace_invite membocorkan kode undangan AKTIF lewat kode lama
--   B. guru bisa "klaim" role TEACHER ke workspace mana pun yang punya undangan aktif,
--      tanpa kode dan melewati batas kursi (sama seperti firestore.rules, tapi di sini bisa ditutup)
--   C. siapa pun bisa membuat workspace dengan plan/batas berbayar (bypass paywall)
--   D. siapa pun bisa membuat student_profiles palsu untuk workspace/kelas/siswa mana pun
--   E. siswa bisa mengisi submissions.score saat insert

-- A. Hanya kode yang masih menjadi kode aktif workspace yang boleh dilihat.
create or replace function public.lookup_workspace_invite(p_code text)
returns table(workspace_id text, expires_at bigint, workspace_name text, invite_code text)
language sql stable security definer set search_path to '' as $function$
  select i.workspace_id, i.expires_at, w.name, w.invite_code
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.code = p_code and w.invite_code = i.code
  limit 1;
$function$;

-- B. Klaim role mandiri hanya untuk (tanpa role) atau OWNER workspace sendiri.
--    Bergabung sebagai TEACHER hanya lewat public.join_workspace_by_code(kode).
create or replace function private.can_claim_role(p_role text, p_workspace_id text)
returns boolean language sql stable security definer set search_path to '' as $function$
  select case
    when p_role is null then true
    when p_workspace_id is null then false
    when p_role = 'OWNER' then exists (
      select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_uid = private.current_uid())
    else false end;
$function$;

-- Penjaga profil guru hanya membatasi peran klien (authenticated/anon). Kode yang berjalan
-- di dalam fungsi SECURITY DEFINER (current_user = pemilik fungsi) atau service_role lolos.
create or replace function private.guard_teacher_profile_update() returns trigger language plpgsql set search_path to '' as $function$
begin
  if (select auth.role()) = 'service_role' or current_user not in ('authenticated', 'anon') then return new; end if;
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

create or replace function public.join_workspace_by_code(p_code text)
returns table(workspace_id text, workspace_name text, role text)
language plpgsql security definer set search_path to '' as $function$
declare
  v_uid text := private.current_uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_ws public.workspaces%rowtype;
  v_existing text;
  v_members integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- Kunci baris workspace supaya dua pendaftar bersamaan tidak sama-sama lolos batas kursi.
  select * into v_ws from public.workspaces w where w.invite_code = v_code for update;
  if not found then raise exception 'invalid invite code' using errcode = 'P0002'; end if;
  if v_ws.invite_code_expires_at is null or v_ws.invite_code_expires_at <= (extract(epoch from now()) * 1000)::bigint then
    raise exception 'invite code expired' using errcode = 'P0001';
  end if;
  select tp.workspace_id into v_existing from public.teacher_profiles tp where tp.user_id = v_uid;
  if v_existing is not null then raise exception 'account already belongs to a workspace' using errcode = 'P0001'; end if;
  select count(*) into v_members from public.teacher_profiles tp where tp.workspace_id = v_ws.id;
  if v_ws.seat_limit is not null and v_members >= v_ws.seat_limit then
    raise exception 'seat limit reached' using errcode = 'P0001';
  end if;
  insert into public.teacher_profiles (user_id, workspace_id, role) values (v_uid, v_ws.id, 'TEACHER')
    on conflict (user_id) do update set workspace_id = excluded.workspace_id, role = excluded.role
    where public.teacher_profiles.workspace_id is null;
  return query select v_ws.id, v_ws.name, 'TEACHER'::text;
end;
$function$;
revoke all on function public.join_workspace_by_code(text) from public, anon;
grant execute on function public.join_workspace_by_code(text) to authenticated;

-- C. Workspace baru hanya boleh berbatas gratis; plan/batas berbayar hanya lewat service_role
--    (webhook pembayaran, Panel Pemilik). Nilai gratis = PLAN_CLASS_LIMITS/FREE_* di lib/config/plans.ts.
drop policy workspaces_owner_insert on public.workspaces;
create policy workspaces_owner_insert on public.workspaces for insert to authenticated with check (
  owner_uid = (select private.current_uid())
  and plan_expires_at is null
  and class_limit between 1 and 3
  and ((plan = 'individual_lifetime' and seat_limit is null) or (plan = 'school_annual' and seat_limit = 1))
);

-- D. Profil siswa dibuat hanya lewat kode login yang valid (klaim identitas dari server).
drop policy student_profiles_self_insert on public.student_profiles;
revoke insert, update, delete on public.student_profiles from authenticated;
create or replace function public.claim_student_profile(p_code text)
returns table(student_id text, workspace_id text, class_name text, name text, nis text)
language plpgsql security definer set search_path to '' as $function$
declare
  v_uid text := private.current_uid();
  c public.student_login_codes%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into c from public.student_login_codes l where l.id = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'invalid login code' using errcode = 'P0002'; end if;
  -- Sekali klaim identitas terkunci (sama seperti student_profiles di firestore.rules: tanpa update).
  insert into public.student_profiles (user_id, workspace_id, student_id, class_name, name, nis)
    values (v_uid, c.workspace_id, c.student_id, c.class_name, c.name, coalesce(c.nis, '-'))
    on conflict (user_id) do nothing;
  return query select sp.student_id, sp.workspace_id, sp.class_name, sp.name, sp.nis
    from public.student_profiles sp where sp.user_id = v_uid;
end;
$function$;
revoke all on function public.claim_student_profile(text) from public, anon;
grant execute on function public.claim_student_profile(text) to authenticated;

-- E. Pengumpulan baru dari siswa tidak boleh membawa nilai.
drop policy submissions_student_insert on public.submissions;
create policy submissions_student_insert on public.submissions for insert to authenticated with check (
  (select private.is_own_student(workspace_id, student_id)) and status = 'menunggu_penilaian'
  and coalesce(feedback, '') = '' and score is null
  and (external_link is null or ((external_link ->> 'provider') = 'google-drive'
       and coalesce(external_link ->> 'url', '') ~ '^https://(drive|docs)[.]google[.]com(/.*)?$')));
