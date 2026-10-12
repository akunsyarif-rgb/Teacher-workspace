-- Probe autentikasi READ-ONLY: menunjukkan bagaimana Supabase memetakan token ke identitas.
-- Dipakai scripts/supabase/verify-auth.mjs. Tidak mengembalikan token atau data baris,
-- hanya klaim non-rahasia + boolean hasil akses RLS pemanggil (SECURITY INVOKER, jadi RLS tetap berlaku).
create or replace function public.auth_probe() returns jsonb
language sql stable set search_path to '' as $function$
  select jsonb_build_object(
    'role', (select auth.role()),
    'sub', (select auth.jwt() ->> 'sub'),
    'uid', (select private.current_uid()),
    'provider', (select auth.jwt() -> 'firebase' ->> 'sign_in_provider'),
    'has_teacher_profile', exists (select 1 from public.teacher_profiles tp where tp.user_id = (select private.current_uid())),
    'has_student_profile', exists (select 1 from public.student_profiles sp where sp.user_id = (select private.current_uid()))
  );
$function$;
revoke all on function public.auth_probe() from public, anon;
grant execute on function public.auth_probe() to authenticated;
