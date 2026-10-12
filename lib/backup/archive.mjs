// Verifikasi + restore arsip ekspor (dipakai skrip restore dan tes). Tidak pernah menulis ke database kecuali apply=true.
import { createHash } from 'node:crypto';
import { readZip } from './zip.mjs';
import { decodeValue } from './valueCodec.mjs';

export const FORMAT = 'teacher-workspace-backup';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Verifikasi menyeluruh: CRC ZIP, manifest, SHA-256 + ukuran tiap berkas, jumlah dokumen per koleksi. Melempar bila ada masalah. */
export function verifyExportZip(zipBuffer) {
  const files = readZip(zipBuffer); // CRC & ukuran tiap entri
  const mf = files.get('manifest.json');
  if (!mf) throw new Error('manifest.json tidak ada — arsip terpotong atau bukan arsip Teacher Workspace.');
  const manifest = JSON.parse(mf.toString('utf8'));
  if (manifest.format !== FORMAT) throw new Error('Format arsip tidak dikenal.');
  if (manifest.formatVersion !== 1) throw new Error(`Versi format ${manifest.formatVersion} belum didukung skrip ini.`);
  const listed = new Set();
  for (const f of manifest.files) {
    const data = files.get(f.name);
    if (!data) throw new Error(`Berkas hilang dari arsip: ${f.name}`);
    if (data.length !== f.bytes || sha256(data) !== f.sha256) throw new Error(`Isi berkas rusak/diubah (SHA-256): ${f.name}`);
    listed.add(f.name);
  }
  for (const name of files.keys()) if (name !== 'manifest.json' && !listed.has(name)) throw new Error(`Berkas tidak tercatat di manifest: ${name}`);
  let total = 0;
  const docs = [];
  for (const [coll, c] of Object.entries(manifest.firestore.collections)) {
    if (c.status !== 'included') continue;
    const lines = files.get(c.file).toString('utf8').split('\n').filter(Boolean);
    if (lines.length !== c.count) throw new Error(`Jumlah dokumen ${coll} (${lines.length}) tidak sama dengan manifest (${c.count}).`);
    for (const l of lines) { const d = JSON.parse(l); if (!d.p.startsWith(`${coll}/`)) throw new Error(`Path di luar koleksi ${coll}: ${d.p}`); docs.push(d); }
    total += lines.length;
  }
  if (total !== manifest.firestore.totalDocs) throw new Error('Total dokumen tidak sama dengan manifest.');
  return { manifest, files, docs };
}

/** Verifikasi satu bagian lampiran (ZIP): tiap file cocok dengan part-manifest. */
export function verifyAttachmentPart(zipBuffer) {
  const files = readZip(zipBuffer);
  const pm = files.get('part-manifest.json');
  if (!pm) throw new Error('part-manifest.json tidak ada.');
  const manifest = JSON.parse(pm.toString('utf8'));
  for (const f of manifest.files) {
    if (f.status !== 'included') continue;
    const data = files.get(`files/${f.path}`);
    if (!data || data.length !== f.bytes || sha256(data) !== f.sha256) throw new Error(`Lampiran rusak/hilang: ${f.path}`);
  }
  return { manifest, files };
}

export async function restoreDocs(db, docs, { apply }) {
  const summary = { totalDocs: docs.length, written: 0, applied: !!apply };
  if (!apply) return summary;
  let batch = db.batch(); let n = 0;
  for (const { p, d } of docs) {
    batch.set(db.doc(p), decodeValue(d, db));
    summary.written++;
    if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n > 0) await batch.commit();
  return summary;
}
