// Decode payload JWT TANPA memverifikasi tanda tangan — hanya untuk membaca klaim milik token sendiri di klien/server
// (mis. memeriksa apakah claim `role` sudah ada). Jangan dipakai untuk keputusan keamanan; Supabase/Firebase yang memverifikasi.
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const part = String(token).split('.')[1];
  if (!part) throw new Error('Token bukan JWT.');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  // Dukung UTF-8 (nama pengguna di klaim).
  return JSON.parse(decodeURIComponent(Array.from(json, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
}

export const hasAuthenticatedRole = (token: string) => {
  try { return decodeJwtClaims(token).role === 'authenticated'; } catch { return false; }
};
