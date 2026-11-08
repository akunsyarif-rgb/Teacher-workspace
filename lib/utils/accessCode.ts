import { randomCode } from './secureRandomCode';

// Alfabet sengaja tanpa 0/O/1/I/L supaya tidak ketuker saat siswa mengetik
// ulang kode dari kertas/papan tulis.
export const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 31^8 ≈ 8,5×10^11 kemungkinan, dihasilkan CSPRNG. Penebakan dibatasi lagi
// oleh rate limit di /api/student/claim.
export function generateAccessCode(length = 8): string {
  return randomCode(ACCESS_CODE_ALPHABET, length);
}
