import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDatabase, createRawDatabase, psql, repoFile } from './ulangan/harness';

// Verifikasi katalog pasca-migrasi (supabase/verify/ulangan_post_migration.sql, READ-ONLY) diuji di Postgres LOKAL:
// lulus pada migrasi yang benar, dan GAGAL bila ada penyimpangan (kontrol negatif) — supaya bisa dipercaya saat dijalankan di staging nanti.
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
const SQL = () => readFileSync(repoFile('supabase/verify/ulangan_post_migration.sql'), 'utf8');
const verify = (url: string, mode: 'migrated' | 'absent' = 'migrated') =>
  psql(url, [], SQL().replace("'migrated'::text as mode", `'${mode}'::text as mode`)).split('\n').filter(Boolean);

suite('verifikasi katalog Ulangan Harian (read-only)', () => {
  it('migrasi benar → semua PASS (owner NOSUPERUSER BYPASSRLS); sebelum migrasi mode absent PASS', () => {
    const before = createRawDatabase(adminUrl as string, []);
    const db = createDatabase(adminUrl as string, 'bypass');
    try {
      expect(verify(before.url, 'absent')).toEqual(['PASS|tidak ada objek ulh_* (sebelum migrasi / sesudah rollback)']);
      const rows = verify(db.url);
      expect(rows.length).toBe(15);
      expect(rows.filter((r) => !r.startsWith('PASS|')), rows.join('\n')).toEqual([]);
      expect(verify(db.url, 'absent')[0]).toMatch(/^FAIL\|/); // setelah migrasi, "absent" harus gagal
      psql(db.url, ['-f', repoFile('supabase/rollback/20261010000000_ulangan_harian_down.sql')]);
      expect(verify(db.url, 'absent')).toEqual(['PASS|tidak ada objek ulh_* (sebelum migrasi / sesudah rollback)']);
    } finally { before.drop(); db.drop(); }
  });

  it('kontrol negatif: tiap penyimpangan keamanan membuat verifikasi GAGAL', () => {
    const cases: [string, RegExp][] = [
      ['grant execute on function public.ulh_list_exams(text, text, boolean) to authenticated', /FAIL\|RPC publik: authenticated TIDAK boleh execute/],
      ['grant execute on function public.ulh_get_attempt(text, uuid) to anon', /FAIL\|RPC publik: anon TIDAK boleh execute/],
      ['grant execute on function public.ulh_get_attempt(text, uuid) to public', /FAIL\|RPC publik: PUBLIC TIDAK boleh execute/],
      ['grant execute on function private.ulh_finalize(uuid, text) to service_role', /FAIL\|helper private: service_role TIDAK boleh execute/],
      ['grant select on public.ulh_question_keys to service_role', /FAIL\|tabel: anon\/authenticated\/service_role tanpa hak apa pun/],
      ['grant select on public.ulh_attempts to authenticated', /FAIL\|tabel: anon\/authenticated\/service_role tanpa hak apa pun/],
      ['alter table public.ulh_answers disable row level security', /FAIL\|semua tabel RLS aktif/],
      ['create policy x on public.ulh_exams for select using (true)', /FAIL\|tidak ada policy pada tabel ulh_\*/],
      ['alter function public.ulh_list_exams(text, text, boolean) security invoker', /FAIL\|semua RPC publik SECURITY DEFINER/],
      ['alter function public.ulh_list_exams(text, text, boolean) reset search_path', /FAIL\|semua fungsi memakai search_path kosong/],
      ['revoke execute on function public.ulh_list_exams(text, text, boolean) from service_role', /FAIL\|RPC publik: service_role BOLEH execute/],
      ['alter table public.ulh_questions add column correct_option uuid', /FAIL\|kolom kunci tidak ada di tabel soal\/opsi/],
      [`create function public.ulh_bocor() returns text language sql as $$ select option_id::text from public.ulh_question_keys limit 1 $$`, /FAIL\|kunci jawaban hanya dibaca/],
    ];
    for (const [sql, expected] of cases) {
      const db = createDatabase(adminUrl as string, 'bypass');
      try {
        psql(db.url, ['-c', sql], undefined, { PGOPTIONS: '-c role=sb_owner_bypass' });
        const rows = verify(db.url);
        expect(rows.join('\n'), sql).toMatch(expected);
      } finally { db.drop(); }
    }
  }, 120_000);
});
