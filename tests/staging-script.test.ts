import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { psql, withDb } from './rls/harness';

// scripts/supabase/staging.sh diuji pada Postgres LOKAL (tanpa Supabase):
//   RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/staging-script.test.ts
// Uji penolakan target tidak butuh Postgres dan selalu jalan.
const ROOT = path.resolve(__dirname, '..');
const run = (args: string[], url: string, env: Record<string, string> = {}) =>
  spawnSync('bash', ['scripts/supabase/staging.sh', ...args], {
    cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', STAGING_DB_URL: url, ...env } as unknown as NodeJS.ProcessEnv,
  });

const SMADA = 'postgresql://postgres:RAHASIA-1@db.abdkrhmxfpcmgzsxzfyz.supabase.co:5432/postgres';
const WORKFLOW = 'postgresql://postgres:RAHASIA-2@db.htutgpjcynbnyxwgorcb.supabase.co:5432/postgres';
const WORKFLOW_POOLER = 'postgresql://postgres.htutgpjcynbnyxwgorcb:RAHASIA-3@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';

describe('staging.sh — penolakan target (tanpa database)', () => {
  it('SmadaExam selalu ditolak (direct & pooler), sandi tidak bocor', () => {
    for (const url of [SMADA, SMADA.replace('postgres:', 'postgres.x:'), 'postgresql://postgres.abdkrhmxfpcmgzsxzfyz:RAHASIA-4@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres']) {
      const r = run(['apply', '--with-baseline'], url, { PRODUCTION_APPROVED: 'abdkrhmxfpcmgzsxzfyz', BACKUP_FILE: '/etc/hostname' });
      expect(r.status).toBe(2);
      expect(r.stdout + r.stderr).not.toMatch(/RAHASIA/);
    }
  });
  it('Workflow produksi ditolak tanpa persetujuan/backup; pooler juga', () => {
    for (const url of [WORKFLOW, WORKFLOW_POOLER]) {
      expect(run(['apply'], url).status).toBe(2);
      expect(run(['apply'], url, { PRODUCTION_APPROVED: 'htutgpjcynbnyxwgorcb' }).status).toBe(2); // tanpa BACKUP_FILE
      expect(run(['apply'], url, { PRODUCTION_APPROVED: 'htutgpjcynbnyxwgorcb', BACKUP_FILE: '/nonexistent' }).status).toBe(2);
      expect(run(['apply'], url, { PRODUCTION_APPROVED: 'salah', BACKUP_FILE: '/etc/hostname' }).status).toBe(2);
    }
    const r = run(['down'], WORKFLOW, { PRODUCTION_APPROVED: 'htutgpjcynbnyxwgorcb', BACKUP_FILE: '/etc/hostname' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/rollback produksi/);
  });
  it('host asing, URL kosong, mode tak dikenal ditolak', () => {
    expect(run(['check'], 'postgresql://u:p@evil.example.com:5432/postgres').status).toBe(2);
    expect(run(['check'], '').status).toBe(2);
    expect(run(['bogus'], 'postgresql://u:p@127.0.0.1:5432/x').status).toBe(2);
  });
});

const adminUrl = process.env.RLS_TEST_ADMIN_URL;
(adminUrl ? describe : describe.skip)('staging.sh — siklus penuh pada Postgres lokal kosong', () => {
  it('check → apply(+baseline) → verify migrated → apply ulang → down → verify baseline → apply lagi', () => {
    const db = `stg_${process.pid}_${Date.now()}`;
    psql(adminUrl as string, ['-c', `create database ${db}`]);
    const url = withDb(adminUrl as string, db);
    try {
      // Prasyarat lokal yang di Supabase sudah ada (skema auth, peran) — stub uji.
      psql(url, ['-f', path.join(ROOT, 'supabase/test-support/000_auth_stub.sql')]);
      expect(run(['check'], url).stdout).toContain('KOSONG');
      expect(run(['apply'], url).status).toBe(2); // tanpa --with-baseline
      expect(run(['apply', '--with-baseline'], url).status).toBe(0);
      expect(run(['verify', 'migrated'], url).stdout).toContain('HASIL: semua PASS');
      expect(run(['verify', 'baseline'], url).status).toBe(1); // migrasi terpasang → mode baseline harus gagal
      expect(run(['apply'], url).status).toBe(0); // idempoten
      const again = run(['verify', 'migrated'], url);
      expect(again.status, again.stdout + again.stderr).toBe(0);
      expect(run(['down'], url).status).toBe(0);
      const base = run(['verify', 'baseline'], url);
      expect(base.status, base.stdout + base.stderr).toBe(0);
      expect(run(['verify', 'migrated'], url).status).toBe(1);
      expect(run(['apply'], url).status).toBe(0);
      expect(run(['verify', 'migrated'], url).status).toBe(0);
    } finally {
      psql(adminUrl as string, ['-c', `drop database if exists ${db} with (force)`]);
    }
  });
});
