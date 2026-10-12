// Membaca SATU entri ZIP (mis. manifest.json) di browser/Node tanpa dependensi: DecompressionStream('deflate-raw').
// Hanya untuk menampilkan ringkasan cakupan ke guru; verifikasi penuh (CRC/SHA-256) dilakukan skrip restore.
export async function readZipEntry(bytes, name) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP tidak valid');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP rusak');
    const method = dv.getUint16(p + 10, true); const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true); const xlen = dv.getUint16(p + 30, true); const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const entryName = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (entryName === name) {
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = bytes.subarray(start, start + csize);
      if (method === 0) return raw;
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}
