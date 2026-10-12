// Enkripsi arsip di SISI KLIEN (WebCrypto; berjalan di browser dan Node): kata sandi tidak pernah dikirim ke server.
// Format: "TWE1" | iterasi PBKDF2 (u32) | salt 16 | iv 12 | ciphertext+tag AES-256-GCM. Kunci = PBKDF2-SHA256(kata sandi, salt).
const MAGIC = [0x54, 0x57, 0x45, 0x31];
const ITERATIONS = 600_000;
const subtle = () => globalThis.crypto.subtle;

async function deriveKey(passphrase, salt, iterations, usage) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export const isEncryptedArchive = (bytes) => bytes.length > 4 && MAGIC.every((m, i) => bytes[i] === m);

export async function encryptArchive(passphrase, bytes, iterations = ITERATIONS) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Kata sandi arsip minimal 8 karakter.');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations, 'encrypt');
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const head = new Uint8Array(4 + 4 + 16 + 12);
  head.set(MAGIC, 0);
  new DataView(head.buffer).setUint32(4, iterations);
  head.set(salt, 8); head.set(iv, 24);
  const out = new Uint8Array(head.length + ct.length);
  out.set(head, 0); out.set(ct, head.length);
  return out;
}

export async function decryptArchive(passphrase, bytes) {
  if (!isEncryptedArchive(bytes) || bytes.length < 36 + 16) throw new Error('Berkas bukan arsip terenkripsi Teacher Workspace.');
  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  if (iterations < 100_000 || iterations > 10_000_000) throw new Error('Parameter enkripsi arsip tidak valid.');
  const key = await deriveKey(passphrase, bytes.slice(8, 24), iterations, 'decrypt');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.slice(24, 36) }, key, bytes.slice(36)));
  } catch {
    throw new Error('Gagal membuka arsip: kata sandi salah atau berkas rusak/diubah.');
  }
}
