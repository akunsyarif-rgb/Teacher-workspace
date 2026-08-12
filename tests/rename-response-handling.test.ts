import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regresi penanganan respons rename kelas.
//
// Bug aslinya: submitRenameClass memanggil res.json() TANPA memeriksa res.ok
// maupun content-type. Kalau yang membalas adalah platform (function timeout
// 504, crash 502, halaman error proxy), body-nya HTML/teks — JSON.parse
// melempar SyntaxError mentah yang langsung tertampil ke guru. Di
// WebKit/Safari kalimatnya "The string did not match the expected pattern.",
// sehingga terbaca seolah nama kelas yang diketik salah, padahal masalahnya
// ada di server.
//
// classController mengimpor Firestore adapter (butuh env browser), jadi yang
// diuji di sini fungsinya diimpor lewat dynamic import setelah adapter di-mock.

const RENAME_URL = '/api/classes/rename';

function mockResponse(status: number, body: string, contentType: string) {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

let submitRenameClass: (idToken: string, oldName: string, newName: string) => Promise<any>;

beforeEach(async () => {
  vi.resetModules();
  // Adapter Firestore & konfigurasi firebase tidak relevan untuk fungsi ini —
  // di-stub supaya modulnya bisa diimpor di lingkungan node.
  vi.doMock('@/src/config/firebase', () => ({ db: {}, auth: {}, storage: {} }));
  vi.doMock('../src/config/firebase', () => ({ db: {}, auth: {}, storage: {} }));
  ({ submitRenameClass } = await import('../lib/controllers/classController'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@/src/config/firebase');
  vi.doUnmock('../src/config/firebase');
});

function stubFetch(res: Response) {
  const spy = vi.fn(async () => res);
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function tangkapPesan(res: Response): Promise<string> {
  stubFetch(res);
  try {
    await submitRenameClass('token', 'XI A KESEHATAN 1', 'XI A KESEHATAN 2');
    return '(tidak melempar)';
  } catch (error: any) {
    return error.message;
  }
}

describe('respons non-JSON tidak pernah membocorkan SyntaxError mentah', () => {
  // Inti regresi: apa pun bentuk kegagalannya, pesan yang sampai ke guru
  // TIDAK boleh berupa kalimat parser JSON.
  const kalimatParser = /did not match the expected pattern|Unexpected token|Unexpected end of JSON|is not valid JSON/i;

  it('504 timeout dengan body HTML', async () => {
    const pesan = await tangkapPesan(
      mockResponse(504, '<html><body>An error occurred with your deployment</body></html>', 'text/html')
    );
    expect(pesan).not.toMatch(kalimatParser);
    expect(pesan).toContain('504');
  });

  it('502 crash dengan body teks', async () => {
    const pesan = await tangkapPesan(mockResponse(502, 'Bad Gateway', 'text/plain'));
    expect(pesan).not.toMatch(kalimatParser);
    expect(pesan).toContain('502');
  });

  it('503 layanan tidak tersedia', async () => {
    const pesan = await tangkapPesan(mockResponse(503, 'Service Unavailable', 'text/plain'));
    expect(pesan).not.toMatch(kalimatParser);
    expect(pesan).toContain('503');
  });

  it('body kosong dengan status 200', async () => {
    const pesan = await tangkapPesan(mockResponse(200, '', 'text/plain'));
    expect(pesan).not.toMatch(kalimatParser);
    expect(pesan).toMatch(/tidak dikenali/i);
  });

  it('content-type menjanjikan JSON tapi body terpotong', async () => {
    const pesan = await tangkapPesan(mockResponse(200, '{"renamedCount": 12', 'application/json'));
    expect(pesan).not.toMatch(kalimatParser);
    expect(pesan).toMatch(/tidak dikenali/i);
  });
});

describe('pesan timeout memperingatkan kemungkinan rename separuh jadi', () => {
  // Commit rename dipecah per 500 dokumen dan tidak atomik antar-pecahan,
  // jadi guru TIDAK boleh disuruh langsung mengulang.
  it('504 menyuruh memeriksa dulu, bukan langsung mencoba lagi', async () => {
    const pesan = await tangkapPesan(mockResponse(504, '<html></html>', 'text/html'));
    expect(pesan).toMatch(/sebagian/i);
    expect(pesan).toMatch(/periksa/i);
  });
});

describe('error JSON yang sah dari route kita tetap diteruskan apa adanya', () => {
  it('pesan validasi server tetap tampil', async () => {
    const pesan = await tangkapPesan(
      mockResponse(400, JSON.stringify({ error: 'Nama kelas maksimal 100 karakter.' }), 'application/json')
    );
    expect(pesan).toBe('Nama kelas maksimal 100 karakter.');
  });

  it('kelas bentrok tetap tampil apa adanya', async () => {
    const pesan = await tangkapPesan(
      mockResponse(400, JSON.stringify({ error: 'Kelas "XI A" sudah ada. Pilih nama lain.' }), 'application/json')
    );
    expect(pesan).toBe('Kelas "XI A" sudah ada. Pilih nama lain.');
  });

  it('401 tanpa body JSON diterjemahkan jadi pesan sesi', async () => {
    const pesan = await tangkapPesan(mockResponse(401, 'Unauthorized', 'text/plain'));
    expect(pesan).toMatch(/sesi login/i);
  });
});

describe('jalur sukses tidak berubah', () => {
  it('respons JSON 200 dikembalikan apa adanya', async () => {
    stubFetch(
      mockResponse(200, JSON.stringify({ renamedCount: 42, className: 'XI A KESEHATAN 2' }), 'application/json')
    );
    const hasil = await submitRenameClass('token', 'XI A KESEHATAN 1', 'XI A KESEHATAN 2');
    expect(hasil).toEqual({ renamedCount: 42, className: 'XI A KESEHATAN 2' });
  });

  it('mengirim token dan nama kelas ke route yang benar', async () => {
    const spy = stubFetch(
      mockResponse(200, JSON.stringify({ renamedCount: 1, className: 'B' }), 'application/json')
    );
    await submitRenameClass('token-abc', 'A', 'B');
    const [url, init] = spy.mock.calls[0] as any;
    expect(url).toBe(RENAME_URL);
    expect(init.headers.Authorization).toBe('Bearer token-abc');
    expect(JSON.parse(init.body)).toEqual({ oldName: 'A', newName: 'B' });
  });
});
