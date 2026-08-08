// Alfabet sengaja tanpa 0/O/1/I/L supaya tidak ketuker saat siswa mengetik
// ulang kode dari kertas/papan tulis.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateAccessCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
