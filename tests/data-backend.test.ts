import { describe, expect, it } from 'vitest';
import { OFFLINE_PARITY_READY, isSupabaseCollection } from '../lib/config/dataBackend';

const C = 'session_skip_reasons';

describe('isSupabaseCollection', () => {
  it('default (tanpa env) = Firestore untuk semua koleksi', () => {
    for (const c of [C, 'grades', 'journals', 'attendances']) expect(isSupabaseCollection(c, undefined, undefined)).toBe(false);
    expect(isSupabaseCollection(C, '', 'yes')).toBe(false);
  });
  it('daftar flag SAJA tidak cukup selama belum ada padanan offline', () => {
    expect(OFFLINE_PARITY_READY).toEqual([]);
    expect(isSupabaseCollection(C, C, undefined)).toBe(false);
    expect(isSupabaseCollection(C, C, 'no')).toBe(false);
  });
  it('override staging hanya membuka koleksi yang DICANTUMKAN, tidak koleksi lain', () => {
    expect(isSupabaseCollection(C, ` ${C} , x`, 'yes')).toBe(true);
    expect(isSupabaseCollection('grades', C, 'yes')).toBe(false);
  });
});
