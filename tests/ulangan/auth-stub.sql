-- HANYA UNTUK UJI LOKAL — meniru bagian Supabase yang dipakai tes Ulangan Harian (peran anon/authenticated/service_role, skema auth/private).
-- JANGAN dijalankan di project Supabase mana pun. Salinan mandiri agar tes ulangan tidak bergantung pada file PR lain.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists private;
-- Supabase: auth.jwt() membaca setelan request.jwt.claims yang diisi PostgREST dari token.
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.role() returns text language sql stable as
$$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.role() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to anon, authenticated, service_role;
