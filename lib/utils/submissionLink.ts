/**
 * Validasi link eksternal (Google Drive/Docs) yang boleh ditempel siswa
 * sebagai ALTERNATIF lampiran — dipakai terutama saat upload foto ke
 * Firebase Storage gagal (mis. karena masalah konfigurasi/billing) supaya
 * siswa tetap bisa mengumpulkan tugas.
 *
 * Murni, tanpa network request sama sekali: tidak pernah memverifikasi link
 * itu benar-benar bisa diakses (HTTP 200 bukan bukti apa-apa — bisa saja
 * halaman login Google, bisa saja file yang belum dibagikan). Cuma
 * memastikan formatnya masuk akal, sekaligus menolak protokol berbahaya
 * (javascript:, data:, blob:) sebelum sempat tersimpan dan dibuka guru
 * lewat <a href> di panel review.
 */

const ALLOWED_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

export const SUBMISSION_LINK_PROVIDER = 'google-drive' as const;

export const SUBMISSION_LINK_ERROR_MESSAGE =
  'Link harus berupa URL Google Drive atau Google Docs (contoh: https://drive.google.com/...).';

export type SubmissionExternalLink = {
  provider: typeof SUBMISSION_LINK_PROVIDER;
  url: string;
  label: string;
};

/**
 * null kalau formatnya tidak masuk akal atau protokolnya bukan https, atau
 * URL yang sudah dinormalisasi (lewat parsing ulang oleh URL()) kalau
 * valid. Host dicek lewat kesamaan persis nama host (bukan substring/regex
 * atas string mentah) supaya trik seperti
 * "https://drive.google.com.evil.com" atau
 * "https://evil.com/?u=drive.google.com" tidak ikut lolos.
 */
export function normalizeSubmissionLink(raw: string | null | undefined): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Satu pengecekan ini sekaligus menolak javascript:, data:, blob:, http:,
  // dan protokol lain apa pun selain https.
  if (parsed.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  return parsed.toString();
}

export function isValidSubmissionLink(raw: string | null | undefined): boolean {
  return normalizeSubmissionLink(raw) !== null;
}

/** null kalau link-nya tidak valid — pemanggil wajib menangani kasus itu. */
export function buildSubmissionExternalLink(
  raw: string | null | undefined,
  label = 'Lampiran Google Drive'
): SubmissionExternalLink | null {
  const url = normalizeSubmissionLink(raw);
  if (!url) return null;
  return { provider: SUBMISSION_LINK_PROVIDER, url, label };
}
