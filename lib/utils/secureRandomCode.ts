// Kode acak yang aman secara kriptografis (crypto.getRandomValues — ada di
// browser dan Node 20+), menggantikan Math.random() yang bisa ditebak dan
// bukan CSPRNG. Dipakai untuk kode akses siswa dan kode undangan guru.
//
// Rejection sampling: byte acak yang jatuh di "ekor" (>= batas kelipatan
// panjang alfabet) dibuang, supaya tiap karakter punya peluang SAMA (tanpa
// modulo bias) walau panjang alfabet bukan pembagi 256.
export function randomCode(alphabet: string, length: number): string {
  if (!alphabet || alphabet.length > 256) throw new Error('Alfabet kode tidak valid.');
  if (!Number.isInteger(length) || length < 1) throw new Error('Panjang kode tidak valid.');

  const limit = 256 - (256 % alphabet.length);
  let code = '';
  while (code.length < length) {
    const bytes = new Uint8Array(Math.max(16, (length - code.length) * 2));
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && code.length < length; i++) {
      if (bytes[i] < limit) code += alphabet[bytes[i] % alphabet.length];
    }
  }
  return code;
}
