import { describe, expect, it } from 'vitest';
import { OFFLINE_PARITY_READY, isSupabaseCollection } from '../lib/config/dataBackend';

const C = 'session_skip_reasons';

describe('isSupabaseCollection', () => {
  it('default (tanpa env) = Firestore untuk semua koleksi', () => {
    for (const c of [C, 'grades', 'journals', 'attendances']) expect(isSupabaseCollection(c, undefined, undefined)).toBe(false);
    expect(isSupabaseCollection(C, '', 'yes')).toBe(false);
  });
  it('flag tanpa kesiapan offline TIDAK cukup (koleksi di luar daftar siap)', () => {
    expect(OFFLINE_PARITY_READY).not.toContain('grades');
    expect(isSupabaseCollection('grades', 'grades', undefined)).toBe(false);
    expect(isSupabaseCollection('grades', 'grades', 'no')).toBe(false);
  });
  it('koleksi siap tetap MATI tanpa flag; menyala hanya bila dicantumkan', () => {
    for (const c of OFFLINE_PARITY_READY) {
      expect(isSupabaseCollection(c, undefined, undefined)).toBe(false);
      expect(isSupabaseCollection(c, 'lain', undefined)).toBe(false);
      expect(isSupabaseCollection(c, c, undefined)).toBe(true);
    }
  });
  it('setiap koleksi siap punya pemetaan kolom di adapter', async () => {
    const { SUPABASE_MAPPED_COLLECTIONS } = await import('../lib/adapters/supabaseAdapter');
    for (const c of OFFLINE_PARITY_READY) expect(SUPABASE_MAPPED_COLLECTIONS).toContain(c);
  });
  it('override staging hanya membuka koleksi yang DICANTUMKAN, tidak koleksi lain', () => {
    expect(isSupabaseCollection(C, ` ${C} , x`, 'yes')).toBe(true);
    expect(isSupabaseCollection('grades', C, 'yes')).toBe(false);
  });
});
