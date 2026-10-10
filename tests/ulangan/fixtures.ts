// Fixture bersama tes Ulangan Harian (Postgres lokal): helper test.call/test.exec/test.kv. Tidak ada data identitas:
// aktor (workspace, uid, siswa, kelas) dikirim sebagai argumen RPC, persis seperti yang dilakukan route server.
export const SETUP = `
create schema if not exists test;
create table test.kv (k text primary key, v text);
grant usage on schema test to authenticated, anon, service_role;
grant all on test.kv to authenticated, anon, service_role;
create or replace function test.call(qry text, save_as text default null) returns text language plpgsql as $$
declare r text;
begin
  execute qry into r;
  if save_as is not null then insert into test.kv values (save_as, r) on conflict (k) do update set v = excluded.v; end if;
  return 'ok:' || replace(coalesce(r, '<null>'), E'\\n', ' ');
exception when others then
  return 'err:' || sqlstate || ':' || replace(sqlerrm, E'\\n', ' ');
end $$;
grant execute on function test.call(text, text) to authenticated, anon, service_role;
-- Pernyataan tanpa hasil (DDL / multi-statement). Dipakai langkah raw berawalan '!'.
create or replace function test.exec(qry text) returns text language plpgsql as $$
begin
  execute qry;
  return 'ok:';
exception when others then
  return 'err:' || sqlstate || ':' || replace(sqlerrm, E'\\n', ' ');
end $$;
grant execute on function test.exec(text) to authenticated, anon, service_role;
`;
