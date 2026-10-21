// Hook uji untuk scripts/migration/backfill-skip-reasons.ts: mengalihkan https://<ref>.supabase.co
// ke server palsu lokal (BACKFILL_TEST_REDIRECT=http://127.0.0.1:PORT). Hanya aktif saat NODE_ENV=test.
const redirectFetch = (input, init) => {
  const u = new URL(String(input));
  return fetch(`${process.env.BACKFILL_TEST_REDIRECT}${u.pathname}${u.search}`, init);
};
export default redirectFetch;
