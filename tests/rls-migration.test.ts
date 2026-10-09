import { describe, expect, it } from 'vitest';
import { BASELINE_FILES, createRawDatabase, psql, repoFile } from './rls/harness';

// Uji siklus migrasi di Postgres LOKAL (bukan Supabase):
//   RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/rls-migration.test.ts
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

const UP = [
  'supabase/migrations/20261009000000_rls_hardening.sql',
  'supabase/migrations/20261009000100_auth_probe.sql',
  'supabase/migrations/20261009000200_batch_write.sql',
];
const DOWN = [
  'supabase/rollback/20261009000200_batch_write_down.sql',
  'supabase/rollback/20261009000100_auth_probe_down.sql',
  'supabase/rollback/20261009000000_rls_hardening_down.sql',
];

// Sidik jari katalog: policy, definisi fungsi, grant tabel/fungsi, trigger.
const CATALOG = `
select 'policy|' || tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'')
  from pg_policies where schemaname='public'
union all
select 'func|' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
union all
select 'tgrant|' || table_name || '|' || grantee || '|' || privilege_type
  from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')
union all
select 'fgrant|' || routine_schema || '.' || routine_name || '|' || grantee || '|' || privilege_type
  from information_schema.routine_privileges where routine_schema in ('public','private') and grantee in ('anon','authenticated','PUBLIC')
union all
select 'trigger|' || tgrelid::regclass::text || '|' || tgname from pg_trigger where not tgisinternal
order by 1;`;

const catalog = (url: string) => psql(url, ['-c', CATALOG]);

suite('migrasi Supabase: database kosong, idempoten, rollback', () => {
  it('baseline + migrasi diterapkan pada database kosong tanpa error', () => {
    const db = createRawDatabase(adminUrl as string, [...BASELINE_FILES, ...UP]);
    try {
      expect(catalog(db.url)).toContain('func|public.join_workspace_by_code(p_code text)');
      expect(catalog(db.url)).toContain('func|public.auth_probe()');
    } finally { db.drop(); }
  });

  it('diterapkan DUA KALI menghasilkan katalog identik (idempoten)', () => {
    const db = createRawDatabase(adminUrl as string, [...BASELINE_FILES, ...UP]);
    try {
      const once = catalog(db.url);
      for (const f of UP) psql(db.url, ['-f', repoFile(f)]);
      expect(catalog(db.url)).toBe(once);
    } finally { db.drop(); }
  });

  it('rollback mengembalikan katalog persis ke baseline', () => {
    const base = createRawDatabase(adminUrl as string, BASELINE_FILES);
    const mig = createRawDatabase(adminUrl as string, [...BASELINE_FILES, ...UP]);
    try {
      const expected = catalog(base.url);
      expect(catalog(mig.url)).not.toBe(expected);
      for (const f of DOWN) psql(mig.url, ['-f', repoFile(f)]);
      expect(catalog(mig.url)).toBe(expected);
    } finally { base.drop(); mig.drop(); }
  });

  it('rollback bisa diulang dan migrasi bisa diterapkan lagi setelah rollback', () => {
    const db = createRawDatabase(adminUrl as string, [...BASELINE_FILES, ...UP]);
    try {
      for (const f of DOWN) psql(db.url, ['-f', repoFile(f)]);
      for (const f of DOWN) psql(db.url, ['-f', repoFile(f)]);
      for (const f of UP) psql(db.url, ['-f', repoFile(f)]);
      expect(catalog(db.url)).toContain('func|public.claim_student_profile(p_code text)');
    } finally { db.drop(); }
  });

  it('auth_probe: anon ditolak, authenticated mendapat klaim + boolean RLS (tanpa data baris)', () => {
    const db = createRawDatabase(adminUrl as string, [...BASELINE_FILES, ...UP]);
    try {
      const as = (role: string, claims: string) =>
        psql(db.url, ['-c', `begin; set local role ${role}; select set_config('request.jwt.claims', $j$${claims}$j$, true) is null; select public.auth_probe(); rollback;`]);
      expect(() => as('anon', '{"role":"anon"}')).toThrow(/permission denied/);
      const out = as('authenticated', '{"sub":"uidX","role":"authenticated","firebase":{"sign_in_provider":"anonymous"}}');
      const probe = JSON.parse(out.split('\n').filter((l) => l.startsWith('{')).pop() as string);
      expect(probe).toEqual({
        role: 'authenticated', sub: 'uidX', uid: 'uidX', provider: 'anonymous', has_teacher_profile: false, has_student_profile: false,
      });
    } finally { db.drop(); }
  });
});
