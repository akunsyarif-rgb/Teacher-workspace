import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Harness uji RLS: membuat database Postgres sementara, memuat baseline Supabase
// + migrasi usulan + fixture, lalu menjalankan semua kasus dalam SATU sesi psql
// (tiap kasus = transaksi yang di-rollback). Hanya lokal; tidak menyentuh Supabase.

export type Step = string | { raw: string };
export type Case = { id: string; as: string; steps: Step[]; expect: (string | RegExp)[] };

const ROOT = path.resolve(__dirname, '../..');
const SQL_ORDER = [
  'supabase/test-support/000_auth_stub.sql',
  'supabase/baseline/001_schema.sql',
  'supabase/baseline/002_functions_triggers.sql',
  'supabase/baseline/003_rls_policies_grants.sql',
];

export function psql(url: string, args: string[], input?: string) {
  return execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function withDb(adminUrl: string, db: string) {
  const u = new URL(adminUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

export function migrationFiles(): string[] {
  const dir = path.join(ROOT, 'supabase/migrations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => `supabase/migrations/${f}`);
}

export function createDatabase(adminUrl: string, withMigrations: boolean) {
  const db = `rls_${process.pid}_${Date.now()}`;
  psql(adminUrl, ['-c', `create database ${db}`]);
  const url = withDb(adminUrl, db);
  const files = [...SQL_ORDER, ...(withMigrations ? migrationFiles() : []), 'tests/rls/support.sql', 'tests/rls/fixture.sql'];
  for (const f of files) psql(url, ['-f', path.join(ROOT, f)]);
  return { url, drop: () => psql(adminUrl, ['-c', `drop database if exists ${db} with (force)`]) };
}

const q = (tag: string, sql: string) => `$${tag}$${sql}$${tag}$`;

export function runCases(url: string, cases: Case[]): Record<string, string[]> {
  const out: string[] = [];
  for (const c of cases) {
    const claims = c.as === 'anon' ? '{"role":"anon"}' : JSON.stringify({ sub: c.as, role: 'authenticated' });
    const role = c.as === 'anon' ? 'anon' : 'authenticated';
    out.push('begin;');
    let inRole = false;
    const enter = () => {
      if (!inRole) {
        out.push(`set local role ${role};`, `select set_config('request.jwt.claims', ${q('j', claims)}, true) is null;`);
        inRole = true;
      }
    };
    c.steps.forEach((s, i) => {
      if (typeof s === 'string') {
        enter();
        out.push(`select ${q('i', `${c.id}|${i}|`)} || test.try(${q('s', s)});`);
      } else {
        if (inRole) {
          out.push('reset role;');
          inRole = false;
        }
        out.push(`select ${q('i', `${c.id}|${i}|`)} || test.val(${q('s', s.raw)});`);
      }
    });
    out.push('rollback;');
  }
  const stdout = psql(url, [], out.join('\n'));
  const results: Record<string, string[]> = {};
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(.+?)\|(\d+)\|(.*)$/);
    if (m) (results[m[1]] ??= [])[Number(m[2])] = m[3];
  }
  return results;
}

// Database kosong + daftar file SQL (relatif root repo), tanpa fixture. Untuk uji migrasi/rollback.
export function createRawDatabase(adminUrl: string, files: string[]) {
  const db = `rls_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  psql(adminUrl, ['-c', `create database ${db}`]);
  const url = withDb(adminUrl, db);
  for (const f of files) psql(url, ['-f', path.join(ROOT, f)]);
  return { url, drop: () => psql(adminUrl, ['-c', `drop database if exists ${db} with (force)`]) };
}

export const BASELINE_FILES = SQL_ORDER;
export const repoFile = (f: string) => path.join(ROOT, f);
