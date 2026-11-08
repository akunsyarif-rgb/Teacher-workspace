import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomCode } from '../lib/utils/secureRandomCode';
import { ACCESS_CODE_ALPHABET, generateAccessCode } from '../lib/utils/accessCode';

afterEach(() => vi.restoreAllMocks());

describe('randomCode / generateAccessCode', () => {
  it('panjang 8, hanya karakter alfabet (tanpa 0/O/1/I/L), default dan panjang kustom', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateAccessCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    }
    expect(randomCode('AB', 40)).toMatch(/^[AB]{40}$/);
  });

  it('memakai crypto.getRandomValues dan TIDAK memakai Math.random', () => {
    const mathSpy = vi.spyOn(Math, 'random');
    const cryptoSpy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    generateAccessCode();
    expect(cryptoSpy).toHaveBeenCalled();
    expect(mathSpy).not.toHaveBeenCalled();
  });

  it('rejection sampling: byte di ekor (>= 248 untuk alfabet 31) dibuang, bukan di-modulo', () => {
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    let first = true;
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((arr: Uint8Array) => {
      if (first) {
        first = false;
        arr.fill(250); // semua byte di ekor -> semua harus dibuang
        return arr;
      }
      return real(arr);
    }) as typeof globalThis.crypto.getRandomValues);
    const code = generateAccessCode();
    expect(code).toHaveLength(8);
    expect(globalThis.crypto.getRandomValues).toHaveBeenCalledTimes(2);
  });

  it('byte 0..247 memetakan merata (tiap karakter 8 byte) — tidak ada bias modulo', () => {
    const counts = new Map<string, number>();
    const limit = 256 - (256 % ACCESS_CODE_ALPHABET.length);
    expect(limit).toBe(248);
    for (let b = 0; b < limit; b++) {
      const ch = ACCESS_CODE_ALPHABET[b % ACCESS_CODE_ALPHABET.length];
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(new Set(counts.values())).toEqual(new Set([8]));
  });

  it('distribusi karakter wajar dan tidak ada duplikat pada 5000 kode', () => {
    const seen = new Set<string>();
    const freq = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      const c = generateAccessCode();
      seen.add(c);
      for (const ch of c) freq.set(ch, (freq.get(ch) ?? 0) + 1);
    }
    expect(seen.size).toBe(5000);
    const expected = (5000 * 8) / ACCESS_CODE_ALPHABET.length;
    for (const ch of ACCESS_CODE_ALPHABET) expect(Math.abs((freq.get(ch) ?? 0) - expected) / expected).toBeLessThan(0.15);
  });

  it('menolak parameter tidak valid', () => {
    expect(() => randomCode('', 4)).toThrow();
    expect(() => randomCode('ABC', 0)).toThrow();
  });
});
