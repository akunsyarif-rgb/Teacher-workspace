import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BASELINE_FILES, createRawDatabase, psql, repoFile } from './rls/harness';

// Audit migrasi Ulangan Harian terhadap database yang sudah berisi baseline + migrasi PR #59 (Postgres LOKAL, bukan Supabase):
//   1. migrasi hanya MENAMBAH objek ber-nama ulh_* (tidak ada objek lain yang berubah/hilang, termasuk hak akses sequence/tabel lama)
//   2. rollback mengembalikan katalog persis seperti sebelum migrasi (dan aman dijalankan dua kali)
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

const PRIOR = [
  'supabase/migrations/20261009000000_rls_hardening.sql',
  'supabase/migrations/20261009000100_auth_probe.sql',
  'supabase/migrations/20261009000200_batch_write.sql',
  'supabase/migrations/20261009000300_workspace_admin.sql',
];
const UP = 'supabase/migrations/20261010000000_ulangan_harian.sql';
const DOWN = 'supabase/rollback/20261010000000_ulangan_harian_down.sql';

// Sidik jari katalog: relasi (+pemilik, RLS, ACL), kolom, constraint, indeks, policy, fungsi (definisi+ACL+pemilik+config),
// trigger, skema (ACL), ekstensi, default ACL. Setiap baris diawali kunci objek agar bisa disaring per nama.
const CATALOG = `
select 'rel|' || n.nspname || '.' || c.relname || '|' || c.relkind::text || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity || '|' || pg_get_userbyid(c.relowner) || '|' || coalesce(c.relacl::text, '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private', 'auth', 'test') and c.relkind in ('r', 'S', 'v', 'm', 'p')
union all
select 'col|' || c.oid::regclass || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public', 'private', 'auth', 'test') and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
union all
select 'con|' || conrelid::regclass || '|' || conname || '|' || pg_get_constraintdef(oid) from pg_constraint where connamespace::regnamespace::text in ('public', 'private')
union all
select 'idx|' || schemaname || '.' || tablename || '|' || indexname || '|' || indexdef from pg_indexes where schemaname in ('public', 'private')
union all
select 'policy|' || tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') from pg_policies where schemaname in ('public', 'private')
union all
select 'func|' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '') || '|' || replace(pg_get_functiondef(p.oid), E'\n', ' ')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private', 'auth')
union all
select 'trigger|' || tgrelid::regclass || '|' || tgname || '|' || pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
union all
select 'schema|' || nspname || '|' || pg_get_userbyid(nspowner) || '|' || coalesce(nspacl::text, '') from pg_namespace where nspname in ('public', 'private', 'auth')
union all
select 'ext|' || extname || '|' || extversion from pg_extension
union all
select 'defacl|' || defaclrole::regrole || '|' || defaclnamespace::regnamespace || '|' || defaclobjtype::text || '|' || defaclacl::text from pg_default_acl
union all
select 'type|' || t.typnamespace::regnamespace || '.' || t.typname || '|' || t.typtype::text from pg_type t where t.typtype in ('e', 'd') and t.typnamespace::regnamespace::text in ('public', 'private')
order by 1;`;

const catalog = (url: string) => psql(url, ['-c', CATALOG]).split('\n').filter(Boolean);

// Objek lain yang sudah ada di Workflow dan HARUS tetap utuh: sequence milik tabel lain dengan hak anon/authenticated,
// tabel lain dengan RLS & policy sendiri. (Workflow sendiri tidak punya sequence di public; ini menjaga pernyataan global.)
const OTHER = `
create sequence public.zz_other_seq; grant usage, select on sequence public.zz_other_seq to anon, authenticated;
create table public.zz_other (id bigint generated always as identity primary key, v text);
alter table public.zz_other enable row level security;
create policy zz_other_p on public.zz_other for select to authenticated using (true);
grant select on public.zz_other to authenticated;
revoke all on public.zz_other from anon;`;

suite('migrasi Ulangan Harian: hanya menambah objek ulh_*, rollback bersih', () => {
  const setup = () => {
    const db = createRawDatabase(adminUrl as string, [...BASELINE_FILES, ...PRIOR]);
    psql(db.url, [], OTHER);
    return db;
  };

  it('migrasi tidak mengubah/menghapus objek lain (diff katalog)', () => {
    const db = setup();
    try {
      const before = catalog(db.url);
      psql(db.url, ['-f', repoFile(UP)]);
      const after = catalog(db.url);
      const removed = before.filter((l) => !after.includes(l));
      const added = after.filter((l) => !before.includes(l));
      expect(removed, 'baris katalog lama yang berubah/hilang').toEqual([]);
      const foreign = added.filter((l) => !/ulh_/.test(l.split('|').slice(0, 3).join('|')));
      expect(foreign, 'objek baru yang bukan ulh_*').toEqual([]);
      expect(added.length).toBeGreaterThan(50);
      // objek lama yang sengaja diuji tetap persis sama
      for (const k of ['rel|public.zz_other_seq|', 'rel|public.zz_other|', 'policy|zz_other|']) {
        expect(after.filter((l) => l.startsWith(k))).toEqual(before.filter((l) => l.startsWith(k)));
        expect(before.some((l) => l.startsWith(k)), k).toBe(true);
      }
    } finally { db.drop(); }
  });

  it('rollback mengembalikan katalog persis seperti semula; dua kali aman', () => {
    const db = setup();
    try {
      const before = catalog(db.url);
      psql(db.url, ['-f', repoFile(UP)]);
      psql(db.url, ['-f', repoFile(DOWN)]);
      expect(catalog(db.url)).toEqual(before);
      psql(db.url, ['-f', repoFile(DOWN)]); // idempoten
      expect(catalog(db.url)).toEqual(before);
      psql(db.url, ['-f', repoFile(UP)]); // bisa diterapkan ulang setelah rollback
      expect(catalog(db.url).length).toBeGreaterThan(before.length);
    } finally { db.drop(); }
  });

  it('penerapan kedua gagal tanpa mengubah katalog (bukan diam-diam menimpa)', () => {
    const db = setup();
    try {
      psql(db.url, ['-f', repoFile(UP)]);
      const once = catalog(db.url);
      expect(() => psql(db.url, ['-f', repoFile(UP)])).toThrow();
      expect(catalog(db.url)).toEqual(once);
    } finally { db.drop(); }
  });

  it('teks migrasi/rollback: tidak menyentuh storage/auth/cron/ekstensi/skema, rollback hanya DROP ber-nama ulh_', () => {
    const up = readFileSync(repoFile(UP), 'utf8').replace(/--.*$/gm, '');
    const down = readFileSync(repoFile(DOWN), 'utf8').replace(/--.*$/gm, '');
    for (const re of [/\bstorage\./i, /\bauth\.(users|identities|sessions)\b/i, /\bcron\./i, /create\s+extension/i, /drop\s+(schema|extension|role)/i, /\btruncate\b/i, /create\s+(schema|role)\b/i, /alter\s+(role|default|database|system)/i, /all sequences in schema/i]) {
      expect(up, String(re)).not.toMatch(re);
      expect(down, String(re)).not.toMatch(re);
    }
    const drops = down.match(/drop\s+(?:table|function)\s+if\s+exists[^;]*;/gi) ?? [];
    expect(drops.length).toBeGreaterThan(20);
    for (const d of drops) {
      const names = d.replace(/drop\s+(table|function)\s+if\s+exists/i, '').replace(/\([^)]*\)/g, '').split(',').map((x) => x.replace(/[;\s]|cascade/gi, ''));
      for (const n of names) expect(n, d).toMatch(/^(public|private)\.ulh_\w+$/);
    }
    expect(down).not.toMatch(/\bdelete\s+from\b/i);
  });

  it('dependensi di luar modul hanya fungsi yang ada di Workflow', () => {
    const up = readFileSync(repoFile(UP), 'utf8').replace(/--.*$/gm, '');
    const used = new Set([...up.matchAll(/\b(private|public|auth)\.([a-z_]+)\(/g)].map((m) => `${m[1]}.${m[2]}`).filter((n) => !/\.ulh_/.test(n)));
    // terverifikasi ada di Workflow (query katalog read-only 2026-10-10)
    const EXISTING = new Set(['private.current_uid', 'private.protect_immutable_columns', 'public.set_updated_at', 'auth.jwt', 'auth.role']);
    for (const n of used) expect(EXISTING.has(n), `${n} tidak terverifikasi ada di Workflow`).toBe(true);
    const trg = [...up.matchAll(/execute function ([\w.]+)\(/g)].map((m) => m[1]);
    for (const t of trg) expect(EXISTING.has(t), t).toBe(true);
  });
});
