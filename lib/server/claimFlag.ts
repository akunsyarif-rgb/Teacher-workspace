// Saklar endpoint pemasang claim (/api/auth/supabase-claim). DEFAULT MATI. Dibaca saat REQUEST (runtime server), bukan saat build.
// Toleran terhadap salah ketik umum di dashboard (spasi, tanda kutip, huruf besar), tetapi tetap hanya menerima nilai "ya" yang jelas.
const TRUE_VALUES = new Set(['yes', 'true', '1', 'ya']);

export function isClaimEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
  return TRUE_VALUES.has(v);
}

// Diagnostik NON-RAHASIA untuk jawaban 501 (membantu menemukan mengapa env tidak terbaca di deployment ini): TIDAK pernah memuat nilai env,
// hanya: ada/tidaknya variabel, panjang nilai, nama variabel yang mirip, dan identitas deployment (commit pendek + jenis lingkungan).
// Di Production hanya jawaban minimal.
export function describeClaimFlag(env: Record<string, string | undefined> = process.env) {
  const name = 'ENABLE_SUPABASE_CLAIM';
  const vercelEnv = env.VERCEL_ENV ?? 'tidak-diketahui';
  if (vercelEnv === 'production') return { error: 'Fitur belum diaktifkan.' };
  const raw = env[name];
  const lookalikes = Object.keys(env).filter((k) => k !== name && /claim/i.test(k) && /supabase/i.test(k));
  const state =
    raw === undefined ? 'TIDAK ADA di deployment ini'
    : raw.trim() === '' ? 'ada tetapi KOSONG'
    : `ada tetapi nilainya bukan "yes" (panjang ${raw.length} karakter)`;
  let hint = `Variabel ${name} ${state}.`;
  if (raw === undefined) {
    hint += ' Penyebab umum: variabel dibuat SETELAH deployment ini dibuat (env hanya berlaku untuk deployment baru → Redeploy), cakupan Environment bukan Preview/cabang ini, atau nama salah ketik.';
  } else {
    hint += ' Isi tepat: yes (huruf kecil, tanpa spasi/kutip), lalu Redeploy.';
  }
  if (lookalikes.length) hint += ` Nama mirip yang ditemukan: ${lookalikes.join(', ')}.`;
  return {
    error: 'Fitur belum diaktifkan.',
    hint,
    deployment: { environment: vercelEnv, commit: (env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null, branch: env.VERCEL_GIT_COMMIT_REF ?? null },
  };
}
