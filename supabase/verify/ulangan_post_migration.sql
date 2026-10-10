-- Verifikasi migrasi Ulangan Harian (READ-ONLY; SQL polos, bisa dijalankan lewat psql atau SQL editor/MCP execute_sql).
-- Ubah 'migrated' menjadi 'absent' pada baris params untuk memeriksa keadaan SEBELUM migrasi diterapkan / SESUDAH rollback.
-- Setiap baris hasil: PASS|nama atau FAIL|nama. Semua baris harus PASS.
with params as (select 'migrated'::text as mode),
fn as (
  select p.oid, n.nspname, p.proname, p.prosecdef, coalesce(p.proconfig::text, '') as cfg, p.prosrc,
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as public_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'ulh\_%'
),
tb as (
  select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ulh\_%'
),
checks(name, ok, in_mode) as (
  values
  ('14 RPC publik ulh_* ada', (select count(*) = 14 from fn where nspname = 'public'), 'migrated'),
  ('4 helper private ulh_* ada', (select count(*) = 4 from fn where nspname = 'private'), 'migrated'),
  ('8 tabel ulh_* ada', (select count(*) = 8 from tb), 'migrated'),
  ('semua RPC publik SECURITY DEFINER', (select bool_and(prosecdef) from fn where nspname = 'public'), 'migrated'),
  ('semua fungsi memakai search_path kosong', (select bool_and(cfg like '%search_path%') from fn), 'migrated'),
  ('RPC publik: service_role BOLEH execute', (select bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) from fn where nspname = 'public'), 'migrated'),
  ('RPC publik: authenticated TIDAK boleh execute', (select bool_and(not has_function_privilege('authenticated', oid, 'EXECUTE')) from fn), 'migrated'),
  ('RPC publik: anon TIDAK boleh execute', (select bool_and(not has_function_privilege('anon', oid, 'EXECUTE')) from fn), 'migrated'),
  ('RPC publik: PUBLIC TIDAK boleh execute', (select bool_and(not public_exec) from fn), 'migrated'),
  ('helper private: service_role TIDAK boleh execute', (select bool_and(not has_function_privilege('service_role', oid, 'EXECUTE')) from fn where nspname = 'private'), 'migrated'),
  ('semua tabel RLS aktif', (select bool_and(relrowsecurity) from tb), 'migrated'),
  ('tabel: anon/authenticated/service_role tanpa hak apa pun',
     (select not exists (select 1 from tb, (values ('anon'), ('authenticated'), ('service_role')) r(role)
        where has_table_privilege(r.role, tb.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))), 'migrated'),
  ('tidak ada policy pada tabel ulh_*', (select count(*) = 0 from pg_policies where tablename like 'ulh\_%'), 'migrated'),
  ('kunci jawaban hanya dibaca ulh_save_exam, ulh_get_exam, ulh_finalize',
     (select coalesce(string_agg(proname, ',' order by proname), '') = 'ulh_finalize,ulh_get_exam,ulh_save_exam' from fn where prosrc like '%ulh_question_keys%'), 'migrated'),
  ('kolom kunci tidak ada di tabel soal/opsi', (select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name in ('ulh_questions', 'ulh_options') and column_name ~ '(correct|key|is_right)'), 'migrated'),
  ('tidak ada objek ulh_* (sebelum migrasi / sesudah rollback)', (select count(*) = 0 from fn) and (select count(*) = 0 from tb), 'absent')
)
select case when ok then 'PASS' else 'FAIL' end || '|' || name
from checks where in_mode = (select mode from params) order by ok, name;
