// Fixture bersama tes Ulangan Harian (Postgres lokal): helper test.call/test.kv + proyeksi identitas meniru fixture RLS.
export const SETUP = `
create schema if not exists test;
create table test.kv (k text primary key, v text);
grant usage on schema test to authenticated, anon;
grant all on test.kv to authenticated, anon;
create or replace function test.call(qry text, save_as text default null) returns text language plpgsql as $$
declare r text;
begin
  execute qry into r;
  if save_as is not null then insert into test.kv values (save_as, r) on conflict (k) do update set v = excluded.v; end if;
  return 'ok:' || replace(coalesce(r, '<null>'), E'\\n', ' ');
exception when others then
  return 'err:' || sqlstate || ':' || replace(sqlerrm, E'\\n', ' ');
end $$;
grant execute on function test.call(text, text) to authenticated, anon;
-- Proyeksi identitas modul (di produksi ditulis server lewat service_role dari kebenaran Firestore). Meniru fixture RLS.
insert into public.ulh_members (user_id, kind, workspace_id, role) values
  ('ownerA', 'teacher', 'wsA', 'OWNER'), ('adminA', 'teacher', 'wsA', 'ADMIN'), ('teachA', 'teacher', 'wsA', 'TEACHER'),
  ('hmA', 'teacher', 'wsA', 'TEACHER'), ('ownerB', 'teacher', 'wsB', 'OWNER'), ('teachB', 'teacher', 'wsB', 'TEACHER');
insert into public.ulh_members (user_id, kind, workspace_id, student_id, class_name, name) values
  ('stuA1', 'student', 'wsA', 'sA1', '7A', 'Siswa A1'), ('stuA2', 'student', 'wsA', 'sA2', '7B', 'Siswa A2'),
  ('stuA3', 'student', 'wsA', 'sA3', '7A', 'Siswa A3'), ('stuB1', 'student', 'wsB', 'sB1', '7A', 'Siswa B1');
insert into public.ulh_roster (workspace_id, student_id, class_name, name) values
  ('wsA', 'sA1', '7A', 'Siswa A1'), ('wsA', 'sA2', '7B', 'Siswa A2'), ('wsA', 'sA3', '7A', 'Siswa A3'), ('wsB', 'sB1', '7A', 'Siswa B1');
`;
