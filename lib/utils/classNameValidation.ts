// Validasi className dipakai bersama oleh client (ClassDetail.tsx) dan
// server (classAdminService.ts) supaya aturan sama persis di kedua sisi.
// className HANYA atribut yang bisa diedit bebas — bukan identifier, bukan
// document ID, bukan slug — jadi sengaja TIDAK ada whitelist karakter/regex
// ketat di sini. Satu-satunya aturan: tidak kosong dan tidak kepanjangan.
export const CLASS_NAME_MAX_LENGTH = 100;

export type ClassNameValidationResult =
  | { valid: true; value: string }
  | { valid: false; error: string };

// Merapikan spasi (termasuk non-breaking space dsb. dari keyboard HP/iPad —
// `\s` di JS regex sudah mencakup itu) tanpa mengubah karakter lain sama
// sekali, supaya nama seperti "XI A KESEHATAN 1" tetap apa adanya.
export function normalizeClassName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateClassName(value: string): ClassNameValidationResult {
  const normalized = normalizeClassName(value ?? '');
  if (!normalized) {
    return { valid: false, error: 'Nama kelas wajib diisi.' };
  }
  if (normalized.length > CLASS_NAME_MAX_LENGTH) {
    return { valid: false, error: `Nama kelas maksimal ${CLASS_NAME_MAX_LENGTH} karakter.` };
  }
  return { valid: true, value: normalized };
}
