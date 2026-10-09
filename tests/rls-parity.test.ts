import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cases from './rls/cases';
import { createDatabase, runCases } from './rls/harness';

// Uji paritas RLS Supabase vs firestore.rules. Butuh Postgres LOKAL (bukan Supabase):
//   RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/rls-parity.test.ts
// Tanpa env itu, test dilewati (CI tidak punya Postgres). RLS_TEST_BASELINE_ONLY=1
// memuat HANYA baseline produksi tanpa migrasi usulan (untuk membuktikan celah).
const adminUrl = process.env.RLS_TEST_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite('RLS Supabase: paritas dengan firestore.rules + celah yang ditutup', () => {
  let results: Record<string, string[]> = {};
  let drop = () => {};
  beforeAll(() => {
    const db = createDatabase(adminUrl as string, process.env.RLS_TEST_BASELINE_ONLY !== '1');
    drop = db.drop;
    results = runCases(db.url, cases);
  }, 120_000);
  afterAll(() => drop());

  for (const c of cases) {
    it(c.id, () => {
      const got = results[c.id] ?? [];
      c.expect.forEach((want, i) => {
        if (want instanceof RegExp) expect(got[i], `${c.id} langkah ${i}`).toMatch(want);
        else expect(got[i], `${c.id} langkah ${i}`).toBe(want);
      });
    });
  }
});
