/**
 * Kompres foto di browser sebelum diunggah, supaya bucket tidak boros
 * tempat (foto HP bisa 4-10 MB). Hanya JPEG/PNG/WebP; HEIC, PDF, dan Word
 * dikirim apa adanya. Gagal apa pun = kirim file asli (kompresi tidak
 * boleh menggagalkan pengumpulan).
 */

export const MAX_IMAGE_DIMENSION = 1600;
export const JPEG_QUALITY = 0.8;
const SKIP_BELOW_BYTES = 300 * 1024;
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function targetDimensions(width: number, height: number, max = MAX_IMAGE_DIMENSION) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function compressedFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, '') || 'foto';
  return `${base}.jpg`;
}

export async function compressImageForUpload(file: File, contentType: string): Promise<File> {
  if (!COMPRESSIBLE_TYPES.has(contentType) || file.size < SKIP_BELOW_BYTES) return file;
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = targetDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // JPEG tidak punya transparansi: latar putih supaya PNG transparan tidak jadi hitam.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], compressedFileName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
