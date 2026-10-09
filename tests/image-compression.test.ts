import { describe, expect, it } from 'vitest';
import { compressImageForUpload, compressedFileName, targetDimensions } from '../lib/utils/imageCompression';

describe('imageCompression', () => {
  it('mengecilkan sisi terpanjang ke 1600 dengan rasio tetap', () => {
    expect(targetDimensions(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(targetDimensions(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('nama hasil kompresi berekstensi .jpg', () => {
    expect(compressedFileName('IMG_2738.png')).toBe('IMG_2738.jpg');
    expect(compressedFileName('noext')).toBe('noext.jpg');
  });
  it('PDF/HEIC/file kecil dikembalikan apa adanya', async () => {
    const big = new File([new Uint8Array(500 * 1024)], 'a.pdf', { type: 'application/pdf' });
    expect(await compressImageForUpload(big, 'application/pdf')).toBe(big);
    const heic = new File([new Uint8Array(500 * 1024)], 'a.heic', { type: 'image/heic' });
    expect(await compressImageForUpload(heic, 'image/heic')).toBe(heic);
    const small = new File([new Uint8Array(1000)], 'a.png', { type: 'image/png' });
    expect(await compressImageForUpload(small, 'image/png')).toBe(small);
  });
  it('tanpa canvas/DOM (lingkungan non-browser) -> file asli, tidak melempar', async () => {
    const img = new File([new Uint8Array(500 * 1024)], 'a.png', { type: 'image/png' });
    expect(await compressImageForUpload(img, 'image/png')).toBe(img);
  });
});
