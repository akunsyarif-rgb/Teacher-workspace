import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Harness mandiri tes Ulangan Harian (Postgres LOKAL; tidak menyentuh Supabase). Tidak bergantung pada file tes PR lain.
// owner: undefined = semua objek dibuat superuser. 'bypass' / 'nobypass' = objek dibuat & dimiliki role NOSUPERUSER
// (meniru `postgres` di Supabase: tidak superuser, BYPASSRLS=true; 'nobypass' = kasus terburuk), supaya pemilik tabel/fungsi
// SECURITY DEFINER tunduk pada aturan Postgres seperti di Supabase, bukan lolos semua lewat superuser.
export type OwnerMode = 'bypass' | 'nobypass' | undefined;
export const ROOT = path.resolve(__dirname, '../..');
export const STUB = 'tests/ulangan/auth-stub.sql';
export const MIGRATION = 'supabase/migrations/20261010000000_ulangan_harian.sql';
export const ROLLBACK = 'supabase/rollback/20261010000000_ulangan_harian_down.sql';

export function psql(url: string, args: string[], input?: string, env?: Record<string, string>) {
  return execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], {
    input,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}
export function withDb(adminUrl: string, db: string) {
  const u = new URL(adminUrl);
  u.pathname = `/${db}`;
  return u.toString();
}
const uniq = () => `ulh_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/** Database baru: stub auth + file SQL tambahan (relatif root repo), dimiliki `owner` bila diberikan. */
export function createRawDatabase(adminUrl: string, files: string[], owner?: OwnerMode) {
  const db = uniq();
  const role = owner ? `sb_owner_${owner}` : null;
  if (role) {
    psql(adminUrl, ['-c', `do $$ begin if not exists (select from pg_roles where rolname='${role}') then create role ${role} nosuperuser ${owner === 'bypass' ? 'bypassrls' : 'nobypassrls'} login; end if; end $$`]);
    psql(adminUrl, ['-c', `create database ${db} owner ${role}`]);
  } else {
    psql(adminUrl, ['-c', `create database ${db}`]);
  }
  const url = withDb(adminUrl, db);
  psql(url, ['-f', path.join(ROOT, STUB)]); // stub dipasang superuser seperti skema auth di Supabase
  if (role) psql(url, ['-c', `grant all on schema auth, private to ${role}`]);
  for (const f of files) psql(url, ['-f', path.join(ROOT, f)], undefined, role ? { PGOPTIONS: `-c role=${role}` } : undefined);
  return { url, drop: () => psql(adminUrl, ['-c', `drop database if exists ${db} with (force)`]) };
}
/** Database dengan migrasi ulangan terpasang. */
export const createDatabase = (adminUrl: string, owner?: OwnerMode) => createRawDatabase(adminUrl, [MIGRATION], owner);
export const repoFile = (f: string) => path.join(ROOT, f);
