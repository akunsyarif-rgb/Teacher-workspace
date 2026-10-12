import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getApps, initializeApp } from 'firebase-admin/app';
import { GeoPoint, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { collect, readZip, zipStream } from '../lib/backup/zip.mjs';
import { decryptArchive, encryptArchive, isEncryptedArchive } from '../lib/backup/archiveCrypto.mjs';
import { restoreDocs, verifyAttachmentPart, verifyExportZip } from '../lib/backup/archive.mjs';
import { encodeValue } from '../lib/backup/valueCodec.mjs';
import { exportZip } from '../lib/server/backup/exportWorkspace';
import { MAX_PART_BYTES, partEntries, planAttachments, probePart, validatePaths, PathError } from '../lib/server/backup/attachments';
import { makeUlanganCollector } from '../lib/server/backup/ulanganExport';
import { planCooldownSeconds, resolveMaxDocs, SAFE_MAX_DOCS } from '../lib/server/backup/limits';
import { AttachmentLimitError } from '../lib/server/backup/attachments';
import { DEFAULT_MAX_DOCS } from '../lib/server/backup/exportWorkspace';
import { resolveBackupActor } from '../lib/server/backup/actor';
import { EXPORTED } from '../lib/server/backup/inventory';

// Ekspor backup di Firestore Emulator (proyek terpisah) + Firebase Auth PALSU. Berjalan di `npm run test:rules`.
// Bukan bukti terhadap Firebase/Supabase nyata.
const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const SRC = 'demo-backup-export';
const RESTORE = 'demo-backup-restored';
const ROOT = path.resolve(__dirname, '..');
const hoisted = vi.hoisted(() => ({ db: null as unknown as Firestore }));

vi.mock('@/lib/server/firebaseAdmin', () => ({
  getAdminDb: () => hoisted.db,
  getAdminAuth: () => ({
    verifyIdToken: async (token: string, checkRevoked?: boolean) => {
      const [kind, uid] = token.split(':');
      if (kind === 'ok') return { uid };
      if (kind === 'revoked' && checkRevoked) throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
      if (kind === 'revoked') return { uid };
      throw Object.assign(new Error(kind), { code: kind === 'expired' ? 'auth/id-token-expired' : 'auth/argument-error' });
    },
  }),
}));

const dbOf = (id: string): Firestore => getFirestore(getApps().find((a) => a.name === id) ?? initializeApp({ projectId: id }, id));
const wipe = (id: string) => fetch(`http://${EMU}/emulator/v1/projects/${id}/databases/(default)/documents`, { method: 'DELETE' });
const T0 = Timestamp.fromMillis(1_700_000_000_000);

async function seed(db: Firestore) {
  const set = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  await set('workspaces/wsA', { name: 'Sekolah A', plan: 'school_annual', ownerUid: 'owner', inviteCode: 'KODE-RAHASIA-A', inviteCodeExpiresAt: 99 });
  await set('workspaces/wsB', { name: 'Sekolah B', plan: 'individual', ownerUid: 'ownerB', inviteCode: 'KODE-RAHASIA-B' });
  await set('workspaces/wsE', { name: 'Kosong', plan: 'individual', ownerUid: 'ownerE' });
  const prof = (uid: string, ws: string, role: string, extra: Record<string, unknown> = {}) => set(`teacher_profiles/${uid}`, { workspaceId: ws, role, name: `Guru ${uid}`, isActive: true, ...extra });
  await prof('owner', 'wsA', 'OWNER'); await prof('admin1', 'wsA', 'ADMIN'); await prof('tHome', 'wsA', 'TEACHER', { homeroomClassName: '7A' });
  await prof('tPlain', 'wsA', 'TEACHER'); await prof('tInactive', 'wsA', 'TEACHER', { isActive: false }); await prof('fakeOwner', 'wsA', 'OWNER');
  await prof('ownerB', 'wsB', 'OWNER'); await prof('tB', 'wsB', 'TEACHER'); await prof('ownerE', 'wsE', 'OWNER'); await prof('tGhost', 'wsGhost', 'TEACHER');
  await set('students/s1', { workspaceId: 'wsA', className: '7A', name: 'Budi', accessCode: 'AAAA1111', createdAt: '2026-01-01' });
  await set('students/s2', { workspaceId: 'wsA', className: '7B', name: 'Sari', accessCode: 'BBBB2222' });
  await set('students/b1', { workspaceId: 'wsB', className: '7A', name: 'RAHASIA-SISWA-B', accessCode: 'ZZZZ9999' });
  await set('student_notes/n1', { workspaceId: 'wsA', className: '7A', text: 'catatan 7A' });
  await set('student_notes/n2', { workspaceId: 'wsA', className: '7B', text: 'catatan 7B' });
  await set('student_notes/nb', { workspaceId: 'wsB', className: '7A', text: 'RAHASIA-CATATAN-B' });
  await set('student_achievements/ac1', { workspaceId: 'wsA', className: '7A', title: 'Juara' });
  await set('student_achievements/ac2', { workspaceId: 'wsA', className: '7B', title: 'Lomba' });
  await set('journals/j1', { workspaceId: 'wsA', date: '2026-02-02', at: T0, lokasi: new GeoPoint(-3.8, 122.5), foto: Buffer.from([0, 1, 255]), ref: db.doc('students/s1'), kosong: null, tags: ['a', { b: 1 }], __t: 'bukan-tipe' });
  await set('journals/jb', { workspaceId: 'wsB', date: '2026-02-02', topik: 'RAHASIA-JURNAL-B' });
  await set('grades/g1', { workspaceId: 'wsA', studentId: 's1', nilai: 88.5 });
  await set('payments/p1', { workspaceId: 'wsA', orderId: 'ORDER-1', gross: 100000 });
  await set('student_login_codes/AAAA1111', { workspaceId: 'wsA', studentId: 's1', className: '7A' });
  await set('student_profiles/uS1', { workspaceId: 'wsA', studentId: 's1' });
  await set('workspace_invites/KODE', { workspaceId: 'wsA' });
  await set('assignments/as1', { workspaceId: 'wsA', className: '7A', title: 'Tugas 1', materialFileUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/m?token=SECRETTOKEN', materialFileName: 'materi.pdf', materialFilePath: 'assignment-materials/wsA/as1/owner/materi.pdf' });
  await set('submissions/as1_s1', {
    workspaceId: 'wsA', assignmentId: 'as1', studentId: 's1', className: '7A', textAnswer: 'jawaban',
    attachments: [
      { fileUrl: 'supabase-storage://submission-attachments/submissions/wsA/as1/u1/aaa_foto.jpg', fileName: 'foto.jpg', filePath: 'submissions/wsA/as1/u1/aaa_foto.jpg' },
      { fileUrl: 'supabase-storage://submission-attachments/submissions/wsA/../wsB/as1/u9/jahat.jpg', fileName: 'jahat.jpg' },
      { fileUrl: 'supabase-storage://submission-attachments/submissions/wsB/as9/u9/lain.jpg', fileName: 'lain.jpg' },
      { fileUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/lama?token=TOKEN-LAMA', fileName: 'lama.jpg' },
    ],
    externalLink: { provider: 'google-drive', url: 'https://drive.google.com/file/d/abc' },
  });
  await set('submissions/as1_s2', { workspaceId: 'wsA', assignmentId: 'as1', studentId: 's2', className: '7B', fileUrl: 'supabase-storage://submission-attachments/submissions/wsA/as1/u2/bbb_lama.pdf', fileName: 'lama.pdf' });
  await set('submissions/bsub', { workspaceId: 'wsB', assignmentId: 'b1', studentId: 'b1', className: '7A', attachments: [{ fileUrl: 'supabase-storage://submission-attachments/submissions/wsB/b1/ub/rahasia.jpg', fileName: 'rahasia.jpg' }] });
  await set('mystery/x1', { workspaceId: 'wsA', x: 1 });
}

let POST: (r: NextRequest) => Promise<Response>;
let ATT: (r: NextRequest) => Promise<Response>;
const call = (token: string | null, body: unknown = {}, route: 'export' | 'attachments' = 'export') =>
  (route === 'export' ? POST : ATT)(new NextRequest(`http://localhost/api/backup/${route}`, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const zipOf = async (token: string) => { const r = await call(token); expect(r.status).toBe(200); return Buffer.from(await r.arrayBuffer()); };
const lines = (z: Map<string, Buffer>, name: string) => (z.get(name)?.toString('utf8') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const allText = (z: Map<string, Buffer>) => [...z.entries()].map(([k, v]) => `${k}\n${v.toString('utf8')}`).join('\n');

beforeAll(async () => {
  if (!EMU) throw new Error('Butuh Firestore Emulator (jalankan lewat npm run test:rules).');
  process.env.BACKUP_COOLDOWN_SECONDS = '0';
  await Promise.all([wipe(SRC), wipe(RESTORE)]);
  hoisted.db = dbOf(SRC);
  await seed(hoisted.db);
  POST = (await import('../app/api/backup/export/route')).POST;
  ATT = (await import('../app/api/backup/attachments/route')).POST;
}, 60000);
afterAll(async () => { await Promise.all([wipe(SRC), wipe(RESTORE)]); });
beforeEach(() => { process.env.BACKUP_COOLDOWN_SECONDS = '0'; process.env.BACKUP_PLAN_COOLDOWN_SECONDS = '0'; delete process.env.BACKUP_MAX_DOCS; delete process.env.BACKUP_MAX_DOCS_ALLOW_ABOVE_SAFE; });

describe('otorisasi server', () => {
  it('tanpa token / token tidak valid / kedaluwarsa / dicabut → 401, tanpa membocorkan detail', async () => {
    for (const t of [null, 'junk:x', 'expired:owner', 'revoked:owner']) {
      const r = await call(t);
      expect(r.status, String(t)).toBe(401);
      const j = await r.json();
      expect(JSON.stringify(j)).not.toMatch(/auth\/|revoked|stack|owner/);
      expect(r.headers.get('content-type')).not.toMatch(/zip/);
    }
  });
  it('bukan guru aktif → 403 (siswa, guru nonaktif, OWNER palsu, workspace tidak ada, uid tak dikenal)', async () => {
    for (const uid of ['uS1', 'tInactive', 'fakeOwner', 'tGhost', 'tidakAda']) {
      const r = await call(`ok:${uid}`);
      expect(r.status, uid).toBe(403);
      expect((await r.json()).code).toBe('not_a_teacher');
    }
  });
  it('respons arsip tidak bisa di-cache dan berupa lampiran unduhan', async () => {
    const r = await call('ok:owner');
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="teacher-workspace-backup-\d{8}-\d{4}\.zip"$/);
    expect(r.headers.get('content-type')).toBe('application/zip');
    await r.arrayBuffer();
  });
});

describe('isolasi workspace & hak per peran', () => {
  it('OWNER wsA: hanya data wsA; tidak ada data/kode wsB; kode undangan, payments, dan indeks login tidak ikut', async () => {
    const z = readZip(await zipOf('ok:owner'));
    const text = allText(z);
    expect(text).not.toMatch(/RAHASIA-SISWA-B|RAHASIA-CATATAN-B|RAHASIA-JURNAL-B|KODE-RAHASIA-B|KODE-RAHASIA-A|ORDER-1|ownerB|ZZZZ9999/);
    for (const [name] of z) if (name.startsWith('firestore/')) for (const l of lines(z, name)) { const body = l.d.__t === 'map' ? l.d.v : l.d; if (body.workspaceId !== undefined) expect(body.workspaceId, name).toBe('wsA'); }
    expect(z.has('firestore/payments.ndjson') || z.has('firestore/student_login_codes.ndjson') || z.has('firestore/student_profiles.ndjson')).toBe(false);
    expect(lines(z, 'firestore/workspaces.ndjson').map((l) => l.p)).toEqual(['workspaces/wsA']);
    expect(lines(z, 'firestore/students.ndjson').map((l) => l.p).sort()).toEqual(['students/s1', 'students/s2']);
  });
  it('workspaceId dari body diabaikan: guru wsB yang meminta wsA tetap hanya mendapat wsB', async () => {
    const r = await call('ok:ownerB', { workspaceId: 'wsA', ws: 'wsA' });
    const z = readZip(Buffer.from(await r.arrayBuffer()));
    const text = allText(z);
    expect(text).toMatch(/RAHASIA-SISWA-B/);
    expect(text).not.toMatch(/Budi|Sari|catatan 7A/);
  });
  it('guru biasa: profil sendiri saja; catatan/prestasi hanya bila wali kelas (dan hanya kelasnya)', async () => {
    const plain = readZip(await zipOf('ok:tPlain'));
    expect(lines(plain, 'firestore/teacher_profiles.ndjson').map((l) => l.p)).toEqual(['teacher_profiles/tPlain']);
    expect(plain.has('firestore/student_notes.ndjson')).toBe(false);
    expect(plain.has('firestore/student_achievements.ndjson')).toBe(false);
    const m = JSON.parse(plain.get('manifest.json')!.toString());
    expect(m.firestore.collections.student_notes.status).toBe('skipped_by_role');
    expect(m.coverage.firestore).toBe('sebagian'); // koleksi tak dikenal 'mystery' ikut menurunkan klaim
    const home = readZip(await zipOf('ok:tHome'));
    expect(lines(home, 'firestore/student_notes.ndjson').map((l) => l.p)).toEqual(['student_notes/n1']);
    expect(lines(home, 'firestore/student_achievements.ndjson').map((l) => l.p)).toEqual(['student_achievements/ac1']);
    expect(allText(home)).not.toMatch(/catatan 7B|Lomba/);
  });
  it('ADMIN/OWNER: seluruh catatan, prestasi, dan profil guru workspace', async () => {
    const z = readZip(await zipOf('ok:admin1'));
    expect(lines(z, 'firestore/student_notes.ndjson')).toHaveLength(2);
    expect(lines(z, 'firestore/student_achievements.ndjson')).toHaveLength(2);
    expect(lines(z, 'firestore/teacher_profiles.ndjson').map((l) => l.p).sort()).toEqual(['teacher_profiles/admin1', 'teacher_profiles/fakeOwner', 'teacher_profiles/owner', 'teacher_profiles/tHome', 'teacher_profiles/tInactive', 'teacher_profiles/tPlain']);
  });
});

describe('manifest & kelengkapan', () => {
  it('manifest memuat versi, waktu, cakupan; jumlah, ukuran, dan SHA-256 cocok dengan isi; tidak mengklaim lengkap', async () => {
    const buf = await zipOf('ok:owner');
    const { manifest: m, files } = verifyExportZip(buf);
    expect(m).toMatchObject({ format: 'teacher-workspace-backup', formatVersion: 1, workspace: { id: 'wsA', name: 'Sekolah A' }, exportedBy: { role: 'OWNER' } });
    expect(Date.parse(m.exportedAt)).not.toBeNaN();
    for (const spec of EXPORTED) expect(m.firestore.collections, spec.name).toHaveProperty(spec.name);
    expect(m.firestore.collections.students.count).toBe(2);
    expect(m.firestore.collections.grades.count).toBe(1);
    expect(m.firestore.totalDocs).toBe(Object.values<{ count: number }>(m.firestore.collections).reduce((s, c) => s + c.count, 0));
    expect(m.coverage.overall).toBe('sebagian');
    expect(m.excluded.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(['payments', 'student_profiles', 'student_login_codes', 'workspace_invites']));
    expect(m.gaps.map((g: { source: string }) => g.source)).toEqual(expect.arrayContaining(['firebase_auth', 'firebase_storage', 'supabase_storage', 'restore_ulangan']));
    expect(m.firestore.unrecognizedCollections).toEqual(['mystery']);
    expect(m.ulangan.status).toBe('not_enabled');
    expect(m.ulangan.reason).toMatch(/belum diaktifkan/);
    expect(files.has('README.txt')).toBe(true);
    expect(m.files.map((f: { name: string }) => f.name)).toContain('attachments/index.ndjson');
  });
  it('tipe Firestore (Timestamp, GeoPoint, Bytes, Reference, null, kunci "__t") tersandi tanpa kehilangan tipe', async () => {
    const z = readZip(await zipOf('ok:owner'));
    const wrapped = lines(z, 'firestore/journals.ndjson')[0].d;
    expect(wrapped.__t).toBe('map'); // dokumen yang punya kunci "__t" dibungkus agar tidak ambigu dengan penanda tipe
    const j = wrapped.v;
    expect(j.at).toEqual({ __t: 'ts', s: 1_700_000_000, n: 0 });
    expect(j.lokasi).toEqual({ __t: 'geo', lat: -3.8, lng: 122.5 });
    expect(j.foto).toEqual({ __t: 'bytes', b64: Buffer.from([0, 1, 255]).toString('base64') });
    expect(j.ref).toEqual({ __t: 'ref', path: 'students/s1' });
    expect(j.kosong).toBeNull();
    expect(j.__t).toBe('bukan-tipe');
  });
  it('indeks lampiran: referensi saja (tanpa URL bertoken), sumber dibedakan, path tidak sah ditandai', async () => {
    const z = readZip(await zipOf('ok:owner'));
    const idx = lines(z, 'attachments/index.ndjson');
    expect(JSON.stringify(idx)).not.toMatch(/SECRETTOKEN|TOKEN-LAMA/);
    const by = (s: string) => idx.filter((a) => a.source === s);
    expect(by('supabase_storage').filter((a) => a.validPath).map((a) => a.path).sort()).toEqual(['submissions/wsA/as1/u1/aaa_foto.jpg', 'submissions/wsA/as1/u2/bbb_lama.pdf']);
    expect(by('supabase_storage').filter((a) => !a.validPath).length).toBe(2);
    expect(by('firebase_storage').map((a) => a.name).sort()).toEqual(['lama.jpg', 'materi.pdf']);
    expect(by('external_link')).toHaveLength(1);
    expect(JSON.parse(z.get('manifest.json')!.toString()).attachments.index.count).toBe(idx.length);
  });
  it('workspace tanpa data: arsip sah, jumlah 0, cakupan tetap jujur', async () => {
    const buf = await zipOf('ok:ownerE');
    const { manifest: m } = verifyExportZip(buf);
    expect(m.firestore.collections.students.count).toBe(0);
    expect(m.firestore.collections.workspaces.count).toBe(1);
    expect(m.firestore.collections.teacher_profiles.count).toBe(1);
    expect(m.attachments.index.count).toBe(0);
    expect(m.coverage.overall).toBe('sebagian');
  });
});

describe('integritas arsip', () => {
  it('ZIP valid menurut pustaka independen (python zipfile) dan pembaca sendiri', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'twz-'));
    const f = path.join(dir, 'a.zip');
    writeFileSync(f, await zipOf('ok:owner'));
    const py = spawnSync('python3', ['-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(len(z.namelist()))', f], { encoding: 'utf8' });
    expect(py.status, py.stderr).toBe(0);
    expect(Number(py.stdout)).toBeGreaterThan(15);
  });
  it('terpotong, satu byte berubah, atau isi diganti dengan CRC sah → ditolak', async () => {
    const buf = await zipOf('ok:owner');
    expect(() => readZip(buf.subarray(0, buf.length - 60))).toThrow();
    const flipped = Buffer.from(buf); flipped[Math.floor(flipped.length / 3)] ^= 0xff;
    expect(() => verifyExportZip(flipped)).toThrow();
    // isi students.ndjson diganti (CRC ZIP tetap sah karena dibuat ulang) → SHA-256 di manifest tidak cocok
    const z = readZip(buf);
    const forged = await collect(zipStream((async function* () { for (const [n, d] of z) yield { name: n, data: n === 'firestore/students.ndjson' ? Buffer.from(d.toString().replace('Budi', 'Palsu')) : d }; })()));
    expect(() => verifyExportZip(forged)).toThrow(/SHA-256|Jumlah/);
    // berkas tambahan yang tidak tercatat di manifest
    const extra = await collect(zipStream((async function* () { for (const [n, d] of z) yield { name: n, data: d }; yield { name: 'liar.txt', data: 'x' }; })()));
    expect(() => verifyExportZip(extra)).toThrow(/tidak tercatat/);
  });
  it('arsip terenkripsi sisi klien: round-trip, kata sandi salah/dirusak ditolak, tanpa teks polos', async () => {
    const buf = await zipOf('ok:owner');
    const enc = await encryptArchive('sandi-guru-123', buf, 100_000);
    expect(isEncryptedArchive(enc)).toBe(true);
    expect(Buffer.from(enc).includes(Buffer.from('Budi'))).toBe(false);
    expect(Buffer.from(await decryptArchive('sandi-guru-123', enc)).equals(buf)).toBe(true);
    await expect(decryptArchive('sandi-salah-999', enc)).rejects.toThrow(/kata sandi salah/);
    const bad = new Uint8Array(enc); bad[bad.length - 5] ^= 1;
    await expect(decryptArchive('sandi-guru-123', bad)).rejects.toThrow(/kata sandi salah/);
    await expect(encryptArchive('pendek', buf)).rejects.toThrow(/8 karakter/);
    await expect(decryptArchive('x', new Uint8Array([1, 2, 3]))).rejects.toThrow(/bukan arsip/);
  });
});

describe('kegagalan ekspor', () => {
  it('cooldown: ekspor kedua langsung ditolak 429 + Retry-After; workspace lain tidak terpengaruh', async () => {
    process.env.BACKUP_COOLDOWN_SECONDS = '600';
    await hoisted.db.doc('backup_exports/wsB').delete(); await hoisted.db.doc('backup_exports/wsE').delete();
    expect((await call('ok:ownerB')).status).toBe(200);
    const r = await call('ok:tB');
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await r.json()).code).toBe('cooldown');
    expect((await call('ok:ownerE')).status).toBe(200);
    await hoisted.db.doc('backup_exports/wsB').delete(); await hoisted.db.doc('backup_exports/wsE').delete();
  });
  it('terlalu besar → 413 dan slot dilepas (boleh mencoba lagi)', async () => {
    process.env.BACKUP_COOLDOWN_SECONDS = '600';
    process.env.BACKUP_MAX_DOCS = '3';
    await hoisted.db.doc('backup_exports/wsA').delete();
    const r = await call('ok:owner');
    expect(r.status).toBe(413);
    expect((await r.json()).code).toBe('too_large');
    delete process.env.BACKUP_MAX_DOCS;
    expect((await call('ok:owner')).status).toBe(200);
    await hoisted.db.doc('backup_exports/wsA').delete();
  });
  it('Firestore gagal di tengah aliran: unduhan terputus (bukan arsip "lengkap"), slot dilepas, pesan galat tidak bocor', async () => {
    process.env.BACKUP_COOLDOWN_SECONDS = '600';
    await hoisted.db.doc('backup_exports/wsA').delete();
    const proto = Object.getPrototypeOf(hoisted.db.collection('grades').where('a', '==', 1));
    const real = proto.stream;
    let n = 0;
    const spy = vi.spyOn(proto, 'stream').mockImplementation(function (this: unknown) { if (++n === 4) throw new Error('RAHASIA-DB-DOWN'); return real.call(this); });
    const r = await call('ok:owner');
    expect(r.status).toBe(200); // aliran sudah dimulai
    await expect(r.arrayBuffer()).rejects.toThrow();
    spy.mockRestore();
    expect((await call('ok:owner')).status).toBe(200); // slot dilepas → coba lagi langsung berhasil
    await hoisted.db.doc('backup_exports/wsA').delete();
  });
  it('gagal sebelum aliran (hitung dokumen) → 500 generik tanpa detail; slot dilepas', async () => {
    process.env.BACKUP_COOLDOWN_SECONDS = '600';
    await hoisted.db.doc('backup_exports/wsA').delete();
    const proto = Object.getPrototypeOf(hoisted.db.collection('grades').where('a', '==', 1));
    const spy = vi.spyOn(proto, 'count').mockImplementation(() => { throw new Error('RAHASIA-COUNT-DOWN'); });
    const r = await call('ok:owner');
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/RAHASIA/);
    expect((await call('ok:owner')).status).toBe(200);
    await hoisted.db.doc('backup_exports/wsA').delete();
  });
  it('arsip yang terputus tidak punya direktori pusat → tidak pernah terbaca sebagai arsip sah', async () => {
    const actor = await resolveBackupActor(hoisted.db, 'owner');
    const proto = Object.getPrototypeOf(hoisted.db.collection('grades').where('a', '==', 1));
    const real = proto.stream;
    let n = 0;
    const spy = vi.spyOn(proto, 'stream').mockImplementation(function (this: unknown) { if (++n === 6) throw new Error('putus'); return real.call(this); });
    const got: Buffer[] = [];
    await expect((async () => { for await (const c of exportZip(actor, { db: hoisted.db })) got.push(c); })()).rejects.toThrow('putus');
    spy.mockRestore();
    expect(() => readZip(Buffer.concat(got))).toThrow();
  });
});

describe('Ulangan Harian', () => {
  const EXAM_ID = '11111111-1111-1111-1111-111111111111';
  const ATTEMPT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const actorOf = () => resolveBackupActor(hoisted.db, 'owner');
  const src = { getDoc: async () => ({ workspaceId: 'wsA', role: 'OWNER', isActive: true, ownerUid: 'owner' }), classExists: async () => true, listStudents: async () => [] };
  it('disertakan lewat aksi guru yang sama (aktor dari server, bukan klien) dan tercatat di manifest', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === 'ulh_list_exams') return [{ id: EXAM_ID }];
      if (name === 'ulh_get_exam') return { id: EXAM_ID, questions: [{ correct_index: 1 }] };
      if (name === 'ulh_exam_results') return { exam: { id: EXAM_ID, class_names: [] }, attempts: [{ attempt_id: ATTEMPT_ID, student_id: 's1', leave_count: 1 }] };
      return [{ id: 'ev1' }];
    };
    const collector = makeUlanganCollector({ rpc, src: { ...src, getDoc: async (c: string) => (c === 'teacher_profiles' ? { workspaceId: 'wsA', role: 'OWNER', isActive: true } : { ownerUid: 'owner' }) } }, true);
    const zip = readZip(await collect(exportZip(await actorOf(), { db: hoisted.db, ulangan: collector })));
    const m = JSON.parse(zip.get('manifest.json')!.toString());
    expect(m.ulangan).toMatchObject({ status: 'included', exams: 1 });
    expect(zip.has('ulangan/exams.json')).toBe(true);
    expect([...zip.keys()].some((k) => k === `ulangan/exam-${EXAM_ID}.json`)).toBe(true);
    for (const [, a] of calls) { expect(a.p_ws).toBe('wsA'); expect(a.p_uid).toBe('owner'); }
  });
  it('dinonaktifkan → status not_enabled; RPC gagal → status failed tanpa membocorkan pesan; ekspor Firestore tetap jadi', async () => {
    const off = makeUlanganCollector({ rpc: async () => [], src }, false);
    expect(await off(await actorOf())).toMatchObject({ status: 'not_enabled' });
    const boom = makeUlanganCollector({ rpc: async () => { throw new Error('https://rahasia.supabase.co key=sb_secret_x'); }, src }, true);
    const buf = await collect(exportZip(await actorOf(), { db: hoisted.db, ulangan: boom }));
    const { manifest } = verifyExportZip(buf);
    expect(manifest.ulangan.status).toBe('failed');
    expect(JSON.stringify(manifest)).not.toMatch(/rahasia\.supabase|sb_secret/);
    expect(manifest.firestore.collections.students.count).toBe(2);
  });
});

describe('lampiran (Supabase Storage)', () => {
  it('rencana: hanya lampiran Supabase sah milik workspace sendiri', async () => {
    const plan = await planAttachments(hoisted.db, await resolveBackupActor(hoisted.db, 'owner'));
    expect(plan.map((p) => p.path)).toEqual(['submissions/wsA/as1/u1/aaa_foto.jpg', 'submissions/wsA/as1/u2/bbb_lama.pdf']);
  });
  it('validasi path: lintas workspace, traversal, segmen salah, jumlah berlebih, tipe salah → ditolak', () => {
    const ok = 'submissions/wsA/as1/u1/f.jpg';
    expect(validatePaths('wsA', [ok])).toEqual([ok]);
    for (const bad of [['submissions/wsB/as1/u1/f.jpg'], ['submissions/wsA/../wsB/x/y'], ['submissions/wsA/as1/u1'], ['submissions/wsA/as1//f.jpg'], ['assignment-materials/wsA/a/u/f'], [123], [], 'x', null, Array(31).fill(ok)])
      expect(() => validatePaths('wsA', bad), JSON.stringify(bad).slice(0, 40)).toThrow(PathError);
  });
  it('bagian lampiran dibatasi ±40 MB per permintaan (minimal 1 file)', async () => {
    const mk = (sizes: number[]) => ((url: string) => Promise.resolve(new Response(null, { status: 200, headers: { 'content-length': String(sizes[Number(new URL(url).pathname.split('/').pop()!.replace(/\D/g, ''))]) } }))) as unknown as typeof fetch;
    const paths = ['f0', 'f1', 'f2', 'f3', 'f4'].map((f) => `submissions/wsA/a/u/${f}`);
    const mb = 1024 * 1024;
    expect((await probePart({ url: 'http://x', key: 'k', fetchImpl: mk([10 * mb, 10 * mb, 10 * mb, 10 * mb, 10 * mb]) }, paths)).included).toBe(4);
    expect((await probePart({ url: 'http://x', key: 'k', fetchImpl: mk([50 * mb, 1, 1, 1, 1]) }, paths)).included).toBe(1);
    expect((await probePart({ url: 'http://x', key: 'k', fetchImpl: mk([30 * mb, 30 * mb, 1, 1, 1]) }, paths)).included).toBe(1);
  });
  describe('ukuran lampiran tidak diketahui → fail-safe (tidak dianggap 0)', () => {
    const P = (n: number) => Array.from({ length: n }, (_, i) => `submissions/wsA/a/u/f${i}`);
    const idx = (url: string) => Number(new URL(url).pathname.split('/').pop()!.replace(/\D/g, ''));
    type H = { status?: number; cl?: string | null; throws?: boolean };
    const fx = (heads: Record<number, H>, bodies: Record<number, Buffer> = {}) => ((url: string, init?: RequestInit) => {
      const i = idx(url);
      if (init?.method === 'HEAD') {
        const h = heads[i] ?? { status: 200, cl: '10' };
        if (h.throws) return Promise.reject(new Error('net'));
        return Promise.resolve(new Response(null, { status: h.status ?? 200, headers: h.cl === null || h.cl === undefined ? {} : { 'content-length': h.cl } }));
      }
      const b = bodies[i];
      return Promise.resolve(b ? new Response(new Uint8Array(b), { status: 200 }) : new Response(null, { status: 404 }));
    }) as unknown as typeof fetch;
    const mb = 1024 * 1024;
    it.each([
      ['HEAD 500', { status: 500 }], ['HEAD 403', { status: 403 }], ['HEAD melempar galat', { throws: true }],
      ['content-length hilang', { cl: null }], ['content-length tidak valid', { cl: 'abc' }], ['content-length 0', { cl: '0' }], ['content-length negatif', { cl: '-5' }],
    ] as [string, H][])('%s → file itu sendirian dalam bagiannya (tidak digabung dengan file lain)', async (_n, h) => {
      const heads: Record<number, H> = { 1: h };
      const r = await probePart({ url: 'http://x', key: 'k', fetchImpl: fx(heads) }, P(4));
      expect(r.included).toBe(1); // f0 (kecil) saja; f1 (tak diketahui) ditunda ke bagian sendiri
      expect(r.unknown).toEqual([]);
      const second = await probePart({ url: 'http://x', key: 'k', fetchImpl: fx(heads) }, P(4).slice(1));
      expect(second.included).toBe(1); // bagian kedua = f1 sendirian (tak diketahui), f2 ditunda lagi
      expect(second.unknown).toEqual([P(4)[1]]);
      const first = await probePart({ url: 'http://x', key: 'k', fetchImpl: fx({ 0: h }) }, P(4));
      expect(first.included).toBe(1); // tak diketahui di awal → tetap minimal 1 dan sendirian
      expect(first.unknown).toEqual([P(4)[0]]);
    });
    it('404 = file tidak ada (0 byte, diketahui), bukan tak diketahui', async () => {
      const r = await probePart({ url: 'http://x', key: 'k', fetchImpl: fx({ 1: { status: 404 } }) }, P(4));
      expect(r.included).toBe(4); expect(r.unknown).toEqual([]);
    });
    it('satu file > batas: bagian sendiri, tidak diunduh, tercatat too_large; file lain tidak terlewat', async () => {
      const paths = P(3);
      const heads: Record<number, H> = { 1: { cl: String(MAX_PART_BYTES + 1) } };
      const bodies = { 0: Buffer.from('A'), 1: Buffer.alloc(8, 1), 2: Buffer.from('C') };
      const deps = { url: 'http://x', key: 'k', fetchImpl: fx(heads, bodies) };
      const p1 = await probePart(deps, paths);
      expect(p1.included).toBe(1); expect(p1.oversized).toEqual([]);
      const p2 = await probePart(deps, paths.slice(1));
      expect(p2.included).toBe(1); expect(p2.oversized).toEqual([paths[1]]);
      const buf = await collect(zipStream(partEntries(deps, paths.slice(1, 1 + p2.included), new Date(), p2), { now: new Date() }));
      const { manifest, files } = verifyAttachmentPart(buf);
      expect(manifest.files).toHaveLength(p2.included); // jumlah di manifest = keputusan planner
      expect(manifest.files[0]).toMatchObject({ path: paths[1], status: 'too_large', bytes: 0 });
      expect(files.has(`files/${paths[1]}`)).toBe(false);
      const p3 = await probePart(deps, paths.slice(2));
      expect(p3.included).toBe(1);
    });
    it('GET melaporkan content-length > batas padahal HEAD tidak: tetap too_large tanpa membaca isi', async () => {
      const paths = P(1);
      const fetchImpl = ((_u: string, init?: RequestInit) => Promise.resolve(init?.method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-length': '5' } }) : new Response(new Uint8Array(4), { status: 200, headers: { 'content-length': String(MAX_PART_BYTES + 9) } }))) as unknown as typeof fetch;
      const r = verifyAttachmentPart(await collect(zipStream(partEntries({ url: 'http://x', key: 'k', fetchImpl }, paths, new Date(), {}), { now: new Date() })));
      expect(r.manifest.files[0].status).toBe('too_large');
    });
    it('ukuran tak diketahui di HEAD dan GET tanpa content-length: dibaca dengan plafon; di bawah plafon masuk utuh, di atas plafon → too_large (tidak ada ZIP terpotong)', async () => {
      const paths = P(1);
      const mk = (b: Buffer) => ({ url: 'http://x', key: 'k', fetchImpl: fx({ 0: { status: 500 } }, { 0: b }) });
      const ok = verifyAttachmentPart(await collect(zipStream(partEntries(mk(Buffer.from('ISI')), paths, new Date(), { unknown: paths }), { now: new Date() })));
      expect(ok.manifest.files[0]).toMatchObject({ status: 'included', bytes: 3 });
      expect(ok.files.get(`files/${paths[0]}`)!.toString()).toBe('ISI');
      const big = verifyAttachmentPart(await collect(zipStream(partEntries(mk(Buffer.alloc(MAX_PART_BYTES + 1)), paths, new Date(), { unknown: paths }), { now: new Date() })));
      expect(big.manifest.files[0]).toMatchObject({ status: 'too_large', bytes: 0 });
      expect(big.files.has(`files/${paths[0]}`)).toBe(false);
    });
    it('semua file terpetakan: pembagian berulang tidak melewatkan satu pun (campuran tak diketahui, besar, kecil, hilang)', async () => {
      const paths = P(9);
      const heads: Record<number, H> = { 1: { status: 500 }, 3: { cl: String(MAX_PART_BYTES + 5) }, 4: { cl: null }, 6: { status: 404 }, 7: { cl: String(30 * mb) }, 8: { cl: String(30 * mb) } };
      const seen: string[] = []; let i = 0; let guard = 0;
      while (i < paths.length && guard++ < 20) {
        const r = await probePart({ url: 'http://x', key: 'k', fetchImpl: fx(heads) }, paths.slice(i, i + 30));
        expect(r.included).toBeGreaterThanOrEqual(1);
        seen.push(...paths.slice(i, i + r.included)); i += r.included;
      }
      expect(seen).toEqual(paths);
    });
    it('ukuran maksimum 40 MB per bagian & batas 30 file dipertahankan', async () => {
      const r = await probePart({ url: 'http://x', key: 'k', fetchImpl: fx({ 0: { cl: String(20 * mb) }, 1: { cl: String(20 * mb) }, 2: { cl: '1' } }) }, P(3));
      expect(r.included).toBe(2);
      expect(() => validatePaths('wsA', P(31).map((p) => p))).toThrow(PathError);
    });
  });
  describe('route /api/backup/attachments dengan Storage palsu lokal', () => {
    let server: http.Server; let base = '';
    const store: Record<string, Buffer> = {
      'submissions/wsA/as1/u1/aaa_foto.jpg': Buffer.from('FOTO-ISI-1'),
      'submissions/wsA/as1/u2/bbb_lama.pdf': Buffer.from('PDF-ISI-2'),
      'submissions/wsB/b1/ub/rahasia.jpg': Buffer.from('RAHASIA-LAMPIRAN-B'),
    };
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const key = decodeURIComponent((req.url ?? '').split(`/storage/v1/object/authenticated/submission-attachments/`)[1] ?? '');
        if (req.headers.apikey !== 'sb_secret_testonly_0000') { res.writeHead(401); return res.end(); }
        const b = store[key];
        if (!b) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-length': String(b.length) });
        res.end(req.method === 'HEAD' ? undefined : b);
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      process.env.SUPABASE_URL = base; process.env.SUPABASE_SECRET_KEY = 'sb_secret_testonly_0000';
    });
    afterAll(() => { server.close(); delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; });
    it('plan + part: ZIP berisi file yang diminta, SHA-256 tervalidasi; file hilang dicatat; header jumlah file', async () => {
      const plan = await (await call('ok:owner', { action: 'plan' }, 'attachments')).json();
      expect(plan.files).toHaveLength(2);
      const paths = [...plan.files.map((f: { path: string }) => f.path), 'submissions/wsA/as1/u3/tidak-ada.jpg'];
      const r = await call('ok:owner', { action: 'part', paths }, 'attachments');
      expect(r.status).toBe(200);
      expect(r.headers.get('x-backup-part-included')).toBe('3');
      expect(r.headers.get('cache-control')).toMatch(/no-store/);
      const { manifest, files } = verifyAttachmentPart(Buffer.from(await r.arrayBuffer()));
      expect(files.get('files/submissions/wsA/as1/u1/aaa_foto.jpg')!.toString()).toBe('FOTO-ISI-1');
      expect(manifest.files.map((f: { status: string }) => f.status)).toEqual(['included', 'included', 'missing']);
    });
    it('path workspace lain / traversal → 400; tanpa token → 401; guru wsB tidak bisa mengambil lampiran wsA', async () => {
      const own = 'submissions/wsB/b1/ub/rahasia.jpg';
      const cross = await call('ok:owner', { action: 'part', paths: [own] }, 'attachments');
      expect(cross.status).toBe(400);
      expect(JSON.stringify(await cross.json())).not.toMatch(/RAHASIA/);
      expect((await call('ok:owner', { action: 'part', paths: ['submissions/wsA/../wsB/b1/f'] }, 'attachments')).status).toBe(400);
      expect((await call(null, { action: 'plan' }, 'attachments')).status).toBe(401);
      expect((await call('ok:ownerB', { action: 'part', paths: ['submissions/wsA/as1/u1/aaa_foto.jpg'] }, 'attachments')).status).toBe(400);
      expect((await call('ok:uS1', { action: 'plan' }, 'attachments')).status).toBe(403);
      expect((await call('ok:owner', { action: 'lain' }, 'attachments')).status).toBe(400);
    });
  });
});

describe('pemulihan ke lingkungan terpisah', () => {
  it('arsip → verifikasi → restore ke proyek lain: isi identik dengan sumber (dibanding per dokumen, tipe terjaga)', async () => {
    const buf = await zipOf('ok:owner');
    const { docs, manifest } = verifyExportZip(buf);
    const target = dbOf(RESTORE);
    await wipe(RESTORE);
    const s = await restoreDocs(target, docs, { apply: true });
    expect(s.written).toBe(manifest.firestore.totalDocs);
    const src = hoisted.db;
    for (const d of docs) {
      const a = (await src.doc(d.p).get()).data() as Record<string, unknown>;
      const b = (await target.doc(d.p).get()).data() as Record<string, unknown>;
      const expected = { ...a }; if (d.p === 'workspaces/wsA') { delete expected.inviteCode; delete expected.inviteCodeExpiresAt; }
      expect(JSON.stringify(encodeValue(b)), d.p).toBe(JSON.stringify(encodeValue(expected)));
    }
    const j = (await target.doc('journals/j1').get()).data()!;
    expect(j.at).toBeInstanceOf(Timestamp); expect(j.lokasi).toBeInstanceOf(GeoPoint);
    expect((j.ref as { path: string }).path).toBe('students/s1');
    expect((await target.collection('students').get()).size).toBe(2);
    expect((await target.doc('workspaces/wsB').get()).exists).toBe(false); // tidak ada data workspace lain di tujuan
    expect((await target.collection('payments').get()).size).toBe(0);
  });
  it('dry-run tidak menulis; CLI: verifikasi, terenkripsi, rusak ditolak, penjagaan Firestore nyata', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'twr-'));
    const zipPath = path.join(dir, 'a.zip'); const encPath = path.join(dir, 'a.zip.enc'); const badPath = path.join(dir, 'bad.zip');
    const buf = await zipOf('ok:owner');
    writeFileSync(zipPath, buf);
    writeFileSync(encPath, await encryptArchive('sandi-guru-123', buf, 100_000));
    const bad = Buffer.from(buf); bad[Math.floor(bad.length / 2)] ^= 0xff; writeFileSync(badPath, bad);
    const run = (args: string[], env: Record<string, string> = {}) => spawnSync('node', [path.join(ROOT, 'scripts/backup/restore-export.mjs'), ...args], { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', FIRESTORE_EMULATOR_HOST: EMU ?? '', ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8', cwd: ROOT });
    const dry = run([zipPath, '--project', 'demo-backup-cli']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/Arsip VALID/); expect(dry.stdout).toMatch(/VERIFIKASI SAJA/); expect(dry.stdout).toMatch(/belum tercakup \(firebase_auth\)/);
    expect((await dbOf('demo-backup-cli').collection('students').get()).size).toBe(0);
    expect(run([encPath, '--project', 'demo-backup-cli']).stderr).toMatch(/BACKUP_PASSPHRASE/);
    expect(run([encPath, '--project', 'demo-backup-cli'], { BACKUP_PASSPHRASE: 'salah-salah' }).stderr).toMatch(/kata sandi salah/);
    const okEnc = run([encPath, '--project', 'demo-backup-cli', '--apply'], { BACKUP_PASSPHRASE: 'sandi-guru-123' });
    expect(okEnc.status, okEnc.stderr).toBe(0);
    expect(okEnc.stdout).toMatch(/EMULATOR/);
    expect((await dbOf('demo-backup-cli').collection('students').get()).size).toBe(2);
    const rejected = run([badPath, '--project', 'demo-backup-cli2', '--apply']);
    expect(rejected.status).not.toBe(0); expect(rejected.stderr).toMatch(/TIDAK valid/);
    expect((await dbOf('demo-backup-cli2').collection('students').get()).size).toBe(0);
    const real = run([zipPath, '--project', 'proyek-nyata', '--apply'], { FIRESTORE_EMULATOR_HOST: '', FIREBASE_SERVICE_ACCOUNT: '{"x":1}' });
    expect(real.status).not.toBe(0); expect(real.stderr).toMatch(/--confirm-project/);
    await Promise.all([wipe('demo-backup-cli'), wipe('demo-backup-cli2')]);
  });
});

describe('pengamanan backup manual', () => {
  it('batas dokumen bawaan 15.000; BACKUP_MAX_DOCS tidak bisa melewati batas aman tanpa keputusan eksplisit', () => {
    expect(DEFAULT_MAX_DOCS).toBe(15_000);
    expect(SAFE_MAX_DOCS).toBe(15_000);
    expect(resolveMaxDocs({})).toEqual({ value: 15_000, source: 'default' });
    expect(resolveMaxDocs({ BACKUP_MAX_DOCS: '5000' }).value).toBe(5000);
    expect(resolveMaxDocs({ BACKUP_MAX_DOCS: '60000' })).toEqual({ value: 15_000, source: 'clamped' });
    for (const bad of ['abc', '-1', '0', '1.5']) expect(resolveMaxDocs({ BACKUP_MAX_DOCS: bad }).value).toBe(15_000);
    expect(resolveMaxDocs({ BACKUP_MAX_DOCS: '60000', BACKUP_MAX_DOCS_ALLOW_ABOVE_SAFE: 'yes' }).value).toBe(60_000);
    expect(resolveMaxDocs({ BACKUP_MAX_DOCS: '9999999', BACKUP_MAX_DOCS_ALLOW_ABOVE_SAFE: 'yes' }).value).toBe(100_000);
  });
  it('cooldown perencanaan lampiran bawaan 300 dtk', () => {
    expect(planCooldownSeconds({})).toBe(300);
    expect(planCooldownSeconds({ BACKUP_PLAN_COOLDOWN_SECONDS: 'x' })).toBe(300);
    expect(planCooldownSeconds({ BACKUP_PLAN_COOLDOWN_SECONDS: '0' })).toBe(0);
  });
  it('route lampiran: plan kedua dalam cooldown → 429', async () => {
    process.env.BACKUP_PLAN_COOLDOWN_SECONDS = '300';
    await hoisted.db.doc('backup_exports/wsA__lampiran').delete();
    expect((await call('ok:owner', { action: 'plan' }, 'attachments')).status).toBe(200);
    const r = await call('ok:owner', { action: 'plan' }, 'attachments');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    await hoisted.db.doc('backup_exports/wsA__lampiran').delete();
  });
  it('submissions melebihi batas → ditolak 413 SEBELUM pemindaian penuh (stream tidak pernah dipanggil)', async () => {
    let streamed = 0;
    const fake = { collection: () => ({ where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: 16 }) }) }), stream: () => { streamed++; return (async function* () {})(); } }) }) };
    await expect(planAttachments(fake as never, await resolveBackupActor(hoisted.db, 'owner'), { maxDocs: 15 })).rejects.toBeInstanceOf(AttachmentLimitError);
    expect(streamed).toBe(0);
    // lewat route
    process.env.BACKUP_MAX_DOCS = '1';
    await hoisted.db.doc('backup_exports/wsA__lampiran').delete();
    const r = await call('ok:owner', { action: 'plan' }, 'attachments');
    expect(r.status).toBe(413);
    const j = await r.json();
    expect(j.code).toBe('too_many_submissions');
    expect(j.error).toMatch(/Terlalu banyak pengumpulan tugas/);
    delete process.env.BACKUP_MAX_DOCS;
    await hoisted.db.doc('backup_exports/wsA__lampiran').delete();
  });
  it('Ulangan: backup tidak memanggil RPC yang menulis (hasil/peristiwa) untuk ulangan draf/terbit; hanya yang closed', async () => {
    const IDS = { draft: '11111111-1111-1111-1111-111111111111', pub: '22222222-2222-2222-2222-222222222222', closed: '33333333-3333-3333-3333-333333333333' };
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === 'ulh_list_exams') return [{ id: IDS.draft, status: 'draft' }, { id: IDS.pub, status: 'published' }, { id: IDS.closed, status: 'closed' }];
      if (name === 'ulh_get_exam') return { id: args.p_id, questions: [] };
      if (name === 'ulh_exam_results') return { exam: { id: args.p_id }, attempts: [] };
      return [];
    };
    const src = { getDoc: async (c: string) => (c === 'teacher_profiles' ? { workspaceId: 'wsA', role: 'OWNER', isActive: true } : { ownerUid: 'owner' }), classExists: async () => true, listStudents: async () => [] };
    const zip = readZip(await collect(exportZip(await resolveBackupActor(hoisted.db, 'owner'), { db: hoisted.db, ulangan: makeUlanganCollector({ rpc, src }, true) })));
    const m = JSON.parse(zip.get('manifest.json')!.toString());
    expect(m.ulangan).toMatchObject({ status: 'included', exams: 3, resultsSkipped: 2 });
    const resultCalls = calls.filter(([n]) => n === 'ulh_exam_results');
    expect(resultCalls).toHaveLength(1);
    expect(resultCalls[0][1].p_id).toBe(IDS.closed);
    for (const k of [IDS.draft, IDS.pub]) expect(JSON.parse(zip.get(`ulangan/exam-${k}.json`)!.toString())).toMatchObject({ results: null, resultsStatus: 'skipped_not_closed' });
    const writers = new Set(['ulh_close_exam', 'ulh_start_attempt', 'ulh_answer', 'ulh_publish_exam']);
    expect(calls.filter(([n]) => writers.has(n))).toHaveLength(0);
  });
});
