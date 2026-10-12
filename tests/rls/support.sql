-- Helper uji RLS (hanya lokal). Dijalankan sebagai superuser setelah baseline + migrasi.
create schema if not exists test;
grant usage on schema test to authenticated, anon;
-- Menjalankan satu pernyataan sebagai peran pemanggil; hasil 'ok:<baris>' atau 'err:<sqlstate>'.
-- Blok EXCEPTION = savepoint, jadi kegagalan satu pernyataan tidak membatalkan yang lain.
create or replace function test.try(q text) returns text language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate;
end $$;
-- Nilai kolom pertama baris pertama (dipakai untuk memeriksa isi data sebagai superuser).
create or replace function test.val(q text) returns text language plpgsql as $$
declare r text;
begin
  execute q into r;
  return coalesce(r, '<null>');
exception when others then
  return 'err:' || sqlstate;
end $$;
grant execute on function test.try(text), test.val(text) to authenticated, anon;
