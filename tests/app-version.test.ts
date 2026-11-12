import { describe, it, expect } from 'vitest';
import { isStaleClient, shouldCheckNow, parseVersionResponse } from '@/lib/utils/appVersion';
import { GET } from '@/app/api/version/route';

describe('pengecekan versi aplikasi', () => {
  it('basi hanya bila kedua versi diketahui dan berbeda', () => {
    expect(isStaleClient('abc', 'abc')).toBe(false);
    expect(isStaleClient('abc', 'def')).toBe(true);
    expect(isStaleClient('', 'def')).toBe(false);
    expect(isStaleClient('abc', null)).toBe(false);
    expect(isStaleClient(undefined, undefined)).toBe(false);
  });
  it('dibatasi frekuensinya', () => {
    expect(shouldCheckNow(1000, 20_000, 30_000)).toBe(false);
    expect(shouldCheckNow(1000, 31_000, 30_000)).toBe(true);
  });
  it('mem-parse balasan dengan aman', () => {
    expect(parseVersionResponse({ version: 'v1' })).toBe('v1');
    expect(parseVersionResponse({ version: '' })).toBeNull();
    expect(parseVersionResponse({ version: 3 })).toBeNull();
    expect(parseVersionResponse(null)).toBeNull();
  });
  it('/api/version publik, tidak di-cache, dan mengembalikan versi build', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['version']);
    expect(typeof body.version).toBe('string');
  });
});
