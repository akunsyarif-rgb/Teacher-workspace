import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/config/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'idtok' } } }));
import { uploadSubmissionFile } from '../lib/adapters/supabaseSubmissionStorage';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

const file = new File(['abc'], 'IMG_2738.png', { type: 'image/png' });

describe('uploadSubmissionFile (browser)', () => {
  it('kirim Bearer ke server lalu PUT file ke signed URL; hasil memuat path', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ signedUrl: 'https://x/up?token=T', token: 'T', path: 'submissions/w/a/u/f.png' }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const r = await uploadSubmissionFile('w', 'a', file);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer idtok');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://x/up?token=T');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('')).toBeInstanceOf(Blob);
    expect(((init.body as FormData).get('') as Blob).type).toBe('image/png');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(r.filePath).toBe('submissions/w/a/u/f.png');
  });
  it('melempar userFacing & tidak ada hasil bila PUT ke Supabase gagal', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ signedUrl: 'https://x/up?token=T', token: 'T', path: 'p' }))
      .mockResolvedValueOnce(new Response('denied', { status: 403 }));
    await expect(uploadSubmissionFile('w', 'a', file)).rejects.toMatchObject({ userFacing: true });
  });
  it('meneruskan pesan server (mis. 503) ke siswa', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Server belum dikonfigurasi' }, { status: 503 }));
    await expect(uploadSubmissionFile('w', 'a', file)).rejects.toThrow('Server belum dikonfigurasi');
  });
  it('PUT gagal jaringan/CORS -> pesan langkah 2 (userFacing)', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ signedUrl: 'https://x/up?token=T', token: 'T', path: 'p' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(uploadSubmissionFile('w', 'a', file)).rejects.toMatchObject({ userFacing: true, message: expect.stringContaining('langkah 2') });
  });
  it('menolak file >10MB tanpa request', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024)], 'b.png', { type: 'image/png' });
    await expect(uploadSubmissionFile('w', 'a', big)).rejects.toMatchObject({ userFacing: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
