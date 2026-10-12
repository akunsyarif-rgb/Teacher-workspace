// Batas keamanan backup manual. Tiap dokumen yang dibaca memakai kuota baca Firestore yang SAMA dengan aplikasi (Spark: 50.000/hari),
// jadi satu ekspor/pemindaian maksimal tidak boleh mendekati kuota itu. Konfigurasi hanya boleh MENURUNKAN batas; menaikkannya
// di atas SAFE_MAX_DOCS butuh keputusan eksplisit (BACKUP_MAX_DOCS_ALLOW_ABOVE_SAFE=yes) dan tetap dibatasi ABSOLUTE_MAX_DOCS.
export const SAFE_MAX_DOCS = 15_000;
export const ABSOLUTE_MAX_DOCS = 100_000;
export const DEFAULT_PLAN_COOLDOWN_SECONDS = 300;

export type MaxDocs = { value: number; source: 'default' | 'env' | 'clamped' | 'invalid' | 'explicit_above_safe' };

export function resolveMaxDocs(env: Record<string, string | undefined> = process.env): MaxDocs {
  const raw = env.BACKUP_MAX_DOCS?.trim();
  if (!raw) return { value: SAFE_MAX_DOCS, source: 'default' };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { value: SAFE_MAX_DOCS, source: 'invalid' }; // nilai ngawur tidak boleh membuka batas
  if (n <= SAFE_MAX_DOCS) return { value: n, source: 'env' };
  if (env.BACKUP_MAX_DOCS_ALLOW_ABOVE_SAFE === 'yes') return { value: Math.min(n, ABSOLUTE_MAX_DOCS), source: 'explicit_above_safe' };
  return { value: SAFE_MAX_DOCS, source: 'clamped' };
}

/** Cooldown pemindaian lampiran (membaca seluruh koleksi submissions). Hanya bilangan bulat ≥ 0; selain itu 300 dtk. */
export function planCooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = env.BACKUP_PLAN_COOLDOWN_SECONDS?.trim();
  if (!raw) return DEFAULT_PLAN_COOLDOWN_SECONDS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_PLAN_COOLDOWN_SECONDS;
}
