// Backup Firestore tanpa billing Google Cloud: baca lewat Admin SDK → NDJSON bertipe → gzip → AES-256-GCM.
// Murni logika (tanpa jaringan ke Drive); dipakai CLI (backup-to-drive.mjs / restore-from-backup.mjs) dan tes emulator.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';

const FORMAT_VERSION = 1;
const MAGIC = Buffer.from('TWB1');

// ---------- Pengodean nilai Firestore → JSON bertipe (tanpa kehilangan tipe) ----------
export function encodeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { __t: 'num', v: String(v) };
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', path: v.path };
  if (v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object') {
    if (typeof v.toArray === 'function' && v.constructor?.name === 'VectorValue') return { __t: 'vec', v: v.toArray() };
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encodeValue(x);
    return '__t' in out ? { __t: 'map', v: out } : out; // peta yang kebetulan punya kunci "__t" dibungkus agar tidak ambigu
  }
  throw new Error(`Tipe nilai tidak didukung: ${typeof v}`);
}

export function decodeValue(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, db));
  switch (v.__t) {
    case 'num': return Number(v.v);
    case 'ts': return new Timestamp(v.s, v.n);
    case 'geo': return new GeoPoint(v.lat, v.lng);
    case 'ref': return db.doc(v.path);
    case 'bytes': return Buffer.from(v.b64, 'base64');
    case 'vec': throw new Error('Nilai vektor tidak didukung saat restore (tidak dipakai aplikasi ini).');
    case 'map': return Object.fromEntries(Object.entries(v.v).map(([k, x]) => [k, decodeValue(x, db)]));
    default: return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeValue(x, db)]));
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- Export ----------
/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ projectId: string, maxDocs?: number, recursive?: boolean, collections?: string[], consistent?: boolean, now?: Date }} opts
 * @returns {Promise<{ ndjson: Buffer, manifest: object }>}
 */
export async function exportFirestore(db, opts) {
  const maxDocs = opts.maxDocs ?? 20000;
  const roots = opts.collections?.length ? opts.collections.map((c) => db.collection(c)) : await db.listCollections();

  // Pagar kuota: tiap dokumen yang dibaca memakai kuota baca harian yang SAMA dengan aplikasi (Spark: 50.000/hari).
  let estimate = 0;
  for (const c of roots) estimate += (await c.count().get()).data().count;
  if (estimate > maxDocs) throw new Error(`Backup dibatalkan: ±${estimate} dokumen melebihi BACKUP_MAX_DOCS=${maxDocs} (melindungi kuota baca aplikasi).`);

  // Satu readTime untuk semua koleksi = gambaran konsisten lintas koleksi (stale read, maks. 1 jam ke belakang).
  const now = opts.now ?? new Date();
  const readTime = Timestamp.fromMillis(now.getTime() - 5000);
  let consistent = opts.consistent !== false;
  const lines = [];
  const counts = {};

  const readAll = async (col) => {
    if (consistent) {
      try {
        return await db.runTransaction(async (t) => (await t.get(col)).docs, { readOnly: true, readTime });
      } catch (e) {
        if (opts.consistent === true) throw e; // diminta wajib konsisten → gagal, jangan diam-diam turun kelas
        consistent = false; // mis. emulator tanpa dukungan readTime; dicatat di manifest
      }
    }
    return (await col.get()).docs;
  };
  const walk = async (col) => {
    for (const d of await readAll(col)) {
      lines.push(JSON.stringify({ p: d.ref.path, d: encodeValue(d.data()) }));
      const top = col.path.split('/')[0];
      counts[top] = (counts[top] ?? 0) + 1;
      if (opts.recursive) for (const sub of await d.ref.listCollections()) await walk(sub);
    }
  };
  for (const c of roots) await walk(c);

  const body = Buffer.from(lines.map((l) => `${l}\n`).join(''));
  const manifest = {
    version: FORMAT_VERSION, projectId: opts.projectId, createdAt: now.toISOString(), readTime: consistent ? readTime.toDate().toISOString() : null,
    consistent, recursive: !!opts.recursive, collections: counts, totalDocs: lines.length, bodySha256: sha256(body),
  };
  return { ndjson: Buffer.concat([body, Buffer.from(`${JSON.stringify({ manifest })}\n`)]), manifest };
}

// ---------- Berkas: gzip + AES-256-GCM (kunci dari frasa sandi via scrypt) ----------
export function sealBackup(ndjson, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) throw new Error('BACKUP_ENCRYPTION_KEY minimal 16 karakter.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(gzipSync(ndjson)), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, enc, c.getAuthTag()]);
}

export function openBackup(file, passphrase) {
  if (file.length < 4 + 16 + 12 + 16 || !file.subarray(0, 4).equals(MAGIC)) throw new Error('Berkas bukan backup Teacher Workspace.');
  const salt = file.subarray(4, 20);
  const iv = file.subarray(20, 32);
  const tag = file.subarray(file.length - 16);
  const key = scryptSync(passphrase, salt, 32);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([d.update(file.subarray(32, file.length - 16)), d.final()]));
  } catch {
    throw new Error('Gagal membuka backup: kunci salah atau berkas rusak/dimodifikasi.');
  }
}

/** Parse + verifikasi integritas isi (hash badan + jumlah per koleksi). */
export function parseBackup(ndjson) {
  const text = ndjson.toString('utf8');
  const all = text.split('\n').filter(Boolean);
  const last = JSON.parse(all[all.length - 1] ?? '{}');
  if (!last.manifest) throw new Error('Manifest backup tidak ditemukan (berkas terpotong?).');
  const docLines = all.slice(0, -1);
  const body = Buffer.from(docLines.map((l) => `${l}\n`).join(''));
  if (sha256(body) !== last.manifest.bodySha256) throw new Error('Hash isi backup tidak cocok dengan manifest.');
  const docs = docLines.map((l) => JSON.parse(l));
  const counts = {};
  for (const d of docs) counts[d.p.split('/')[0]] = (counts[d.p.split('/')[0]] ?? 0) + 1;
  if (JSON.stringify(Object.entries(counts).sort()) !== JSON.stringify(Object.entries(last.manifest.collections).sort()) || docs.length !== last.manifest.totalDocs) {
    throw new Error('Jumlah dokumen tidak cocok dengan manifest.');
  }
  return { manifest: last.manifest, docs };
}

// ---------- Restore ----------
/** Tulis dokumen ke `db` (kosongkan/timpa sesuai `merge:false`). Pemanggil WAJIB sudah memastikan db target bukan produksi. */
export async function restoreInto(db, parsed, { apply }) {
  const summary = { collections: parsed.manifest.collections, totalDocs: parsed.docs.length, written: 0, applied: !!apply };
  if (!apply) return summary;
  let batch = db.batch();
  let n = 0;
  for (const { p, d } of parsed.docs) {
    batch.set(db.doc(p), decodeValue(d, db));
    n++;
    summary.written++;
    if (n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n > 0) await batch.commit();
  return summary;
}

/** Sidik jari kanonik isi database (urut per path) — dipakai membandingkan sumber vs hasil restore. */
export async function fingerprint(db, { recursive = false } = {}) {
  const { ndjson } = await exportFirestore(db, { projectId: 'fingerprint', maxDocs: 1e9, recursive, consistent: false });
  const { docs } = parseBackup(ndjson);
  const h = createHash('sha256');
  for (const d of docs.sort((a, b) => (a.p < b.p ? -1 : 1))) h.update(`${d.p}\n${JSON.stringify(d.d)}\n`);
  return { sha256: h.digest('hex'), totalDocs: docs.length };
}
