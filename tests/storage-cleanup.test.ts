import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminBucket: () => { throw new Error('bucket tidak tersedia'); } }));

import { deleteMaterialFile, deleteSubmissionFiles } from '../lib/server/storageCleanup';

const ENV = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_abc123' };
const ok = () => new Response('[]', { status: 200 });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('deleteSubmissionFiles (Supabase Storage)', () => {
  it('tanpa path -> tidak memanggil jaringan sama sekali (dan tidak butuh konfigurasi)', async () => {
    const fetchImpl = vi.fn();
    expect(await deleteSubmissionFiles([], { env: {}, fetchImpl })).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('DELETE ke bucket privat dengan prefixes unik; header apikey (kunci sb_secret_ tanpa Bearer)', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const n = await deleteSubmissionFiles(['a/1', 'a/1', 'a/2'], { env: ENV, fetchImpl: fetchImpl as never });
    expect(n).toBe(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/submission-attachments');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({ prefixes: ['a/1', 'a/2'] });
    expect((init.headers as Record<string, string>).apikey).toBe('sb_secret_abc123');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('memecah per 100 path', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const paths = Array.from({ length: 250 }, (_, i) => `p/${i}`);
    expect(await deleteSubmissionFiles(paths, { env: ENV, fetchImpl: fetchImpl as never })).toBe(250);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String((fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body)).prefixes).toHaveLength(50);
  });

  it('penyimpanan menolak -> ApiError 502 tanpa membocorkan detail hulu', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"bucket secret-internal row-level security"}', { status: 400 }));
    const err = await deleteSubmissionFiles(['a/1'], { env: ENV, fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(err).toMatchObject({ status: 502 });
    expect(err.message).not.toMatch(/secret-internal|row-level|bucket/i);
  });

  it('jaringan putus -> 502, bukan lolos diam-diam', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET internal.host'); });
    const err = await deleteSubmissionFiles(['a/1'], { env: ENV, fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(err).toMatchObject({ status: 502 });
    expect(err.message).not.toMatch(/ECONNRESET|internal\.host/);
  });

  it('konfigurasi Supabase tidak ada/tidak valid -> 503 dengan pesan aman (tidak diam-diam melewati penghapusan berkas)', async () => {
    const err = await deleteSubmissionFiles(['a/1'], { env: {}, fetchImpl: vi.fn() as never }).catch((e) => e);
    expect(err).toMatchObject({ status: 503 });
    expect(err.message).not.toMatch(/SUPABASE_URL|server_config/);
  });
});

describe('deleteMaterialFile (Firebase Storage, upaya terbaik)', () => {
  it('kegagalan tidak melempar (mengembalikan false) agar tidak membatalkan penghapusan dokumen', async () => {
    await expect(deleteMaterialFile('assignment-materials/w1/a1/u/soal.pdf')).resolves.toBe(false);
  });
});
