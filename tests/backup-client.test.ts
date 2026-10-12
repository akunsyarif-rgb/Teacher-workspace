import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../lib/repositories/backupRepository';
import * as service from '../lib/services/backupService';
import * as controller from '../lib/controllers/backupController';
import { collect, zipStream } from '../lib/backup/zip.mjs';
import { readZipEntry } from '../lib/backup/zipEntry.mjs';
import { decryptArchive } from '../lib/backup/archiveCrypto.mjs';

// Sisi klien Backup & Ekspor Data dengan fetch palsu: semua lewat /api/backup/*, galat dipetakan ke bahasa guru,
// unduhan yang terputus tidak pernah dianggap berhasil, kata sandi tidak pernah dikirim ke server.
const fetchImpl = vi.fn();
beforeEach(() => { fetchImpl.mockReset(); repo.__setBackupDeps({ getToken: async () => 'tok', fetchImpl: fetchImpl as never }); });
const json = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

const manifest = { exportedAt: '2026-10-12T00:00:00Z', firestore: { totalDocs: 3, collections: { students: { status: 'included', count: 2 }, student_notes: { status: 'skipped_by_role', count: 0 } }, unrecognizedCollections: ['mystery'] },
  ulangan: { status: 'not_enabled', reason: 'x' }, attachments: { index: { count: 4, bySource: { supabase_storage: 2 } } }, gaps: [{ source: 'firebase_auth', detail: 'd' }], excluded: [{ name: 'payments', reason: 'r' }], coverage: { firestore: 'sebagian', overall: 'sebagian' } };
const zipBytes = async (extra: Record<string, string> = {}) => new Uint8Array(await collect(zipStream((async function* () {
  yield { name: 'README.txt', data: 'hai' };
  for (const [n, d] of Object.entries(extra)) yield { name: n, data: d };
  yield { name: 'manifest.json', data: JSON.stringify(manifest) };
})())));

describe('repository: galat dan keamanan permintaan', () => {
  it('tanpa token → tidak ada permintaan jaringan; token dikirim hanya di header, body tidak memuat workspace/peran', async () => {
    repo.__setBackupDeps({ getToken: async () => null, fetchImpl: fetchImpl as never });
    await expect(repo.downloadExport()).rejects.toMatchObject({ code: 'not_logged_in', status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
    repo.__setBackupDeps({ getToken: async () => 'tok', fetchImpl: fetchImpl as never });
    fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-disposition': 'attachment; filename="b.zip"' } }));
    const r = await repo.downloadExport();
    expect(r.filename).toBe('b.zip');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/backup/export');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.body).toBe('{}');
  });
  it('403/429/413/500/jaringan putus → pesan yang dapat dipahami guru, tanpa detail teknis', async () => {
    fetchImpl.mockResolvedValueOnce(json({ error: 'Akun ini bukan akun guru aktif di sebuah workspace.', code: 'not_a_teacher' }, 403));
    await expect(repo.downloadExport()).rejects.toMatchObject({ code: 'not_a_teacher', status: 403, message: expect.stringMatching(/bukan akun guru/) });
    fetchImpl.mockResolvedValueOnce(json({ error: 'Backup baru saja dibuat. Coba lagi dalam 5 menit.', code: 'cooldown' }, 429, { 'retry-after': '300' }));
    await expect(repo.downloadExport()).rejects.toMatchObject({ code: 'cooldown', retryAfterSeconds: 300 });
    fetchImpl.mockResolvedValueOnce(json({ error: 'Data terlalu besar', code: 'too_large' }, 413));
    expect(controller.describeBackupError(await repo.downloadExport().catch((e) => e))).toMatch(/terlalu besar/);
    fetchImpl.mockResolvedValueOnce(new Response('<html>stack trace</html>', { status: 502 }));
    expect(controller.describeBackupError(await repo.downloadExport().catch((e) => e))).toMatch(/gagal dibuat/);
    fetchImpl.mockRejectedValueOnce(new TypeError('failed'));
    expect(controller.describeBackupError(await repo.downloadExport().catch((e) => e))).toMatch(/Periksa internet/);
    expect(controller.describeBackupError(new Error('detail internal RAHASIA'))).not.toMatch(/RAHASIA/);
  });
  it('koneksi putus di tengah unduhan → galat "terputus", bukan arsip setengah jadi', async () => {
    const broken = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.error(new Error('reset')); } });
    fetchImpl.mockResolvedValueOnce(new Response(broken, { status: 200 }));
    await expect(repo.downloadExport()).rejects.toMatchObject({ code: 'interrupted', message: expect.stringMatching(/tidak disimpan/) });
  });
  it('bagian lampiran: jumlah file dibaca dari header; header tidak sah ditolak', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { 'x-backup-part-included': '7' } }));
    expect((await repo.downloadAttachmentPart(['submissions/w/a/u/f'])).included).toBe(7);
    fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    await expect(repo.downloadAttachmentPart(['submissions/w/a/u/f'])).rejects.toMatchObject({ code: 'bad_part' });
  });
});

describe('service', () => {
  it('validasi kata sandi: minimal 8 karakter dan konfirmasi harus sama', () => {
    expect(service.validatePassphrase('pendek', 'pendek')).toMatch(/minimal 8/);
    expect(service.validatePassphrase('sandi-panjang-1', 'beda-lagi-xx')).toMatch(/tidak sama/);
    expect(service.validatePassphrase('sandi-panjang-1', 'sandi-panjang-1')).toBeNull();
  });
  it('tanpa kata sandi: arsip apa adanya; dengan kata sandi: terenkripsi, bisa dibuka lagi, kata sandi TIDAK dikirim ke server', async () => {
    const zip = await zipBytes();
    fetchImpl.mockImplementation(async () => new Response(zip, { status: 200, headers: { 'content-disposition': 'attachment; filename="b.zip"' } }));
    const plain = await service.createBackup('');
    expect(plain.encrypted).toBe(false);
    expect(plain.filename).toBe('b.zip');
    expect(plain.summary).toMatchObject({ totalDocs: 3, coverage: { overall: 'sebagian' }, unrecognized: ['mystery'] });
    const enc = await service.createBackup('sandi-rahasia-123');
    expect(enc.encrypted).toBe(true);
    expect(enc.filename).toBe('b.zip.enc');
    expect(Buffer.from(enc.bytes).includes(Buffer.from('hai'))).toBe(false);
    expect(Buffer.from(await decryptArchive('sandi-rahasia-123', enc.bytes)).equals(Buffer.from(zip))).toBe(true);
    for (const [, init] of fetchImpl.mock.calls) expect(String(init.body)).not.toMatch(/sandi-rahasia/);
  });
  it('ringkasan tidak terbaca (manifest hilang/rusak) → null, arsip tetap dikembalikan', async () => {
    const noManifest = new Uint8Array(await collect(zipStream((async function* () { yield { name: 'a.txt', data: 'x' }; })())));
    fetchImpl.mockResolvedValueOnce(new Response(noManifest, { status: 200 }));
    expect((await service.createBackup('')).summary).toBeNull();
    fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([9, 9, 9]), { status: 200 }));
    expect((await service.createBackup('')).summary).toBeNull();
  });
  it('lampiran diunduh bagian demi bagian sampai semua file tercakup (jumlah per bagian mengikuti server) dan tiap bagian disimpan terpisah', async () => {
    const files = Array.from({ length: 70 }, (_, i) => ({ path: `submissions/w/a/u/f${i}`, name: null, assignmentId: null, studentId: null, className: null }));
    fetchImpl.mockResolvedValueOnce(json({ files }, 200));
    const asked: number[] = [];
    fetchImpl.mockImplementation(async (_u: string, init: { body: string }) => {
      const paths = JSON.parse(init.body).paths as string[];
      asked.push(paths.length);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'x-backup-part-included': String(Math.min(paths.length, 25)) } }); // server memuat ≤25 (batas ukuran)
    });
    const saved: string[] = []; const progress: number[] = [];
    const r = await service.downloadAllAttachments('', (n) => saved.push(n), (p) => progress.push(p.files));
    expect(r).toEqual({ files: 70, parts: 3 });
    expect(asked).toEqual([30, 30, 20]); // 25 + 25 + 20 = 70: tidak ada file terlewat
    expect(saved).toEqual(['teacher-workspace-lampiran-bagian-01.zip', 'teacher-workspace-lampiran-bagian-02.zip', 'teacher-workspace-lampiran-bagian-03.zip']);
    expect(progress.at(-1)).toBe(70);
  });
  it('lampiran: bagian gagal di tengah → galat (bagian sebelumnya sudah tersimpan); terenkripsi → .enc', async () => {
    fetchImpl.mockResolvedValueOnce(json({ files: [{ path: 'submissions/w/a/u/f1' }, { path: 'submissions/w/a/u/f2' }] }, 200));
    fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { 'x-backup-part-included': '1' } }));
    fetchImpl.mockResolvedValueOnce(json({ error: 'gagal', code: 'attachments_failed' }, 500));
    const saved: string[] = [];
    await expect(service.downloadAllAttachments('sandi-rahasia-123', (n) => saved.push(n), () => {})).rejects.toMatchObject({ code: 'attachments_failed' });
    expect(saved).toEqual(['teacher-workspace-lampiran-bagian-01.zip.enc']);
  });
});

describe('membuka arsip terenkripsi di perangkat', () => {
  it('berkas .enc + kata sandi benar → ZIP asli; sandi salah / bukan arsip → pesan jelas', async () => {
    const zip = await zipBytes();
    fetchImpl.mockImplementation(async () => new Response(zip, { status: 200, headers: { 'content-disposition': 'attachment; filename="b.zip"' } }));
    const enc = await service.createBackup('sandi-rahasia-123');
    const ok = await service.decryptBackupFile(enc.bytes, 'sandi-rahasia-123', 'b.zip.enc');
    expect(ok.filename).toBe('b.zip');
    expect(Buffer.from(ok.bytes).equals(Buffer.from(zip))).toBe(true);
    expect(controller.describeBackupError(await service.decryptBackupFile(enc.bytes, 'salah-salah-1', 'b.zip.enc').catch((e) => e))).toMatch(/kata sandi salah/);
    expect(controller.describeBackupError(await service.decryptBackupFile(new Uint8Array([1, 2, 3, 4, 5]), 'x', 'x.enc').catch((e) => e))).toMatch(/bukan arsip terenkripsi/);
  });
});

describe('pembaca entri ZIP di browser', () => {
  it('membaca manifest.json dari ZIP nyata (deflate); entri tidak ada → null; ZIP rusak → galat', async () => {
    const z = await zipBytes({ 'a/b.txt': 'x'.repeat(5000) });
    const raw = await readZipEntry(z, 'manifest.json');
    expect(JSON.parse(new TextDecoder().decode(raw!)).firestore.totalDocs).toBe(3);
    expect(new TextDecoder().decode((await readZipEntry(z, 'a/b.txt'))!)).toBe('x'.repeat(5000));
    expect(await readZipEntry(z, 'tidak-ada')).toBeNull();
    await expect(readZipEntry(new Uint8Array([1, 2, 3, 4]), 'x')).rejects.toThrow();
  });
});
