// ZIP streaming tanpa dependensi (deflate + data descriptor; tanpa ZIP64). Dipakai route ekspor (server), skrip restore, dan tes.
// Memori terbatas: tiap entri dikompres per blok; seluruh arsip tidak pernah dibangun sekaligus di memori.
import { deflateRawSync, constants, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf, prev = 0) {
  let c = ~prev >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const BLOCK = 256 * 1024;
const U32_MAX = 0xffffffff;
const dosDateTime = (d) => ({
  time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  date: ((Math.max(d.getUTCFullYear(), 1980) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
});
const toBuf = (c) => (typeof c === 'string' ? Buffer.from(c, 'utf8') : Buffer.from(c));

/**
 * @param {AsyncIterable<{ name: string, data: Buffer | string | AsyncIterable<Buffer | string> | Iterable<Buffer | string> }>} entries
 * @param {{ now?: Date, onEntry?: (e: { name: string, size: number, compressedSize: number, crc32: number }) => void }} [opts]
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* zipStream(entries, opts = {}) {
  const { time, date } = dosDateTime(opts.now ?? new Date());
  const central = [];
  let offset = 0;
  const out = (b) => { offset += b.length; return b; };
  for await (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    if (entry.name.startsWith('/') || entry.name.includes('..') || name.length > 0xffff) throw new Error(`Nama entri ZIP tidak valid: ${entry.name}`);
    const localOffset = offset;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0808, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt16LE(name.length, 26);
    yield out(Buffer.concat([lh, name]));
    let crc = 0; let size = 0; let csize = 0; let pending = [];
    let pendingLen = 0;
    const flushBlock = function* (final) {
      const raw = Buffer.concat(pending); pending = []; pendingLen = 0;
      if (raw.length) { const z = deflateRawSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }); csize += z.length; yield out(z); }
      if (final) { const end = Buffer.from([0x03, 0x00]); csize += 2; yield out(end); } // blok akhir kosong → aliran deflate sah
    };
    const source = typeof entry.data === 'string' || Buffer.isBuffer(entry.data) ? [entry.data] : entry.data;
    for await (const chunk of source) {
      const b = toBuf(chunk);
      crc = crc32(b, crc); size += b.length;
      pending.push(b); pendingLen += b.length;
      if (pendingLen >= BLOCK) yield* flushBlock(false);
    }
    yield* flushBlock(true);
    if (size > U32_MAX || csize > U32_MAX || offset > U32_MAX) throw new Error('Arsip melebihi batas ZIP (4 GB).');
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(csize, 8); dd.writeUInt32LE(size, 12);
    yield out(dd);
    central.push({ name, crc, csize, size, localOffset });
    opts.onEntry?.({ name: entry.name, size, compressedSize: csize, crc32: crc });
  }
  const cdStart = offset;
  for (const e of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(8, 10);
    h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.csize, 20); h.writeUInt32LE(e.size, 24);
    h.writeUInt16LE(e.name.length, 28); h.writeUInt32LE(e.localOffset, 42);
    yield out(Buffer.concat([h, e.name]));
  }
  if (central.length > 0xffff) throw new Error('Terlalu banyak entri ZIP.');
  const cdSize = offset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16);
  yield out(eocd);
}

/** Baca ZIP utuh (tes + restore). Memverifikasi CRC dan ukuran tiap entri; melempar bila rusak/terpotong. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Berkas ZIP tidak valid atau terpotong (EOCD tidak ditemukan).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Direktori pusat ZIP rusak.');
    const method = buf.readUInt16LE(p + 10); const crc = buf.readUInt32LE(p + 16); const csize = buf.readUInt32LE(p + 20); const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32); const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`Header lokal rusak: ${name}`);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`CRC/ukuran tidak cocok: ${name}`);
    if (files.has(name)) throw new Error(`Entri ganda: ${name}`);
    files.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

export async function collect(gen) {
  const parts = [];
  for await (const c of gen) parts.push(c);
  return Buffer.concat(parts);
}
