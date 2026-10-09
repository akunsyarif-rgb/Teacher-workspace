-- Verifikasi pasca-migrasi (read-only). Dipanggil scripts/supabase/staging.sh verify <migrated|baseline>.
-- Parameter psql: -v mode=migrated|baseline. Setiap baris: PASS|nama atau FAIL|nama.
\set ON_ERROR_STOP on
with checks(name, ok, in_mode) as (
  values
  ('policy student_profiles_self_insert dihapus', not exists (select 1 from pg_policies where tablename='student_profiles' and policyname='student_profiles_self_insert'), 'migrated'),
  ('policy student_profiles_self_insert ada (baseline)', exists (select 1 from pg_policies where tablename='student_profiles' and policyname='student_profiles_self_insert'), 'baseline'),
  ('authenticated tak punya INSERT di student_profiles', not has_table_privilege('authenticated','public.student_profiles','INSERT'), 'migrated'),
  ('policy workspaces_owner_insert membatasi plan', (select with_check like '%class_limit%' from pg_policies where tablename='workspaces' and policyname='workspaces_owner_insert'), 'migrated'),
  ('policy workspaces_owner_insert polos (baseline)', (select with_check not like '%class_limit%' from pg_policies where tablename='workspaces' and policyname='workspaces_owner_insert'), 'baseline'),
  ('policy submissions_student_insert melarang score', (select with_check like '%score IS NULL%' from pg_policies where tablename='submissions' and policyname='submissions_student_insert'), 'migrated'),
  ('fungsi join_workspace_by_code ada', to_regprocedure('public.join_workspace_by_code(text)') is not null, 'migrated'),
  ('fungsi claim_student_profile ada', to_regprocedure('public.claim_student_profile(text)') is not null, 'migrated'),
  ('fungsi auth_probe ada', to_regprocedure('public.auth_probe()') is not null, 'migrated'),
  ('fungsi baru tidak ada (baseline)', to_regprocedure('public.join_workspace_by_code(text)') is null and to_regprocedure('public.auth_probe()') is null, 'baseline'),
  ('anon TIDAK boleh execute join_workspace_by_code', to_regprocedure('public.join_workspace_by_code(text)') is null or not has_function_privilege('anon','public.join_workspace_by_code(text)','EXECUTE'), 'any'),
  ('anon TIDAK boleh execute claim_student_profile', to_regprocedure('public.claim_student_profile(text)') is null or not has_function_privilege('anon','public.claim_student_profile(text)','EXECUTE'), 'any'),
  ('anon TIDAK boleh execute auth_probe', to_regprocedure('public.auth_probe()') is null or not has_function_privilege('anon','public.auth_probe()','EXECUTE'), 'any'),
  ('authenticated boleh execute join_workspace_by_code', to_regprocedure('public.join_workspace_by_code(text)') is null or has_function_privilege('authenticated','public.join_workspace_by_code(text)','EXECUTE'), 'any'),
  ('can_claim_role tanpa cabang TEACHER', not exists (select 1 from pg_proc where oid='private.can_claim_role(text,text)'::regprocedure and prosrc like '%''TEACHER''%'), 'migrated'),
  ('semua tabel public ber-RLS', not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity), 'any'),
  ('anon tanpa hak tabel public', not exists (select 1 from information_schema.role_table_grants where table_schema='public' and grantee='anon'), 'any'),
  ('payments: authenticated hanya SELECT', not has_table_privilege('authenticated','public.payments','INSERT') and not has_table_privilege('authenticated','public.payments','UPDATE') and not has_table_privilege('authenticated','public.payments','DELETE'), 'any'),
  ('trigger protect_immutable terpasang', exists (select 1 from pg_trigger where tgname='trg_protect_immutable'), 'any')
)
select case when ok then 'PASS' else 'FAIL' end || '|' || name
from checks where in_mode in ('any', :'mode') order by 1;
