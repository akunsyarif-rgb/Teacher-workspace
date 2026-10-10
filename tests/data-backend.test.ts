import { describe, expect, it } from 'vitest';
import { OFFLINE_PARITY_READY, STUDENT_FACING, isSupabaseCollection } from '../lib/config/dataBackend';

const C = 'session_skip_reasons';

describe('isSupabaseCollection', () => {
  it('default (tanpa env) = Firestore untuk semua koleksi', () => {
    for (const c of [C, 'grades', 'students', 'journals', 'attendances']) expect(isSupabaseCollection(c, undefined, undefined)).toBe(false);
    expect(isSupabaseCollection(C, '', 'yes')).toBe(false);
  });
  it('flag tanpa kesiapan offline TIDAK cukup (koleksi di luar daftar siap)', () => {
    expect(OFFLINE_PARITY_READY).not.toContain('teacher_profiles');
    expect(isSupabaseCollection('teacher_profiles', 'teacher_profiles', undefined)).toBe(false);
    expect(isSupabaseCollection('teacher_profiles', 'teacher_profiles', 'no')).toBe(false);
  });
  it('koleksi siap tetap MATI tanpa flag; menyala hanya bila dicantumkan (+ gerbang siswa & unit)', () => {
    const ALL = OFFLINE_PARITY_READY.join(',');
    for (const c of OFFLINE_PARITY_READY) {
      expect(isSupabaseCollection(c, undefined, undefined, 'yes')).toBe(false);
      expect(isSupabaseCollection(c, 'lain', undefined, 'yes')).toBe(false);
      expect(isSupabaseCollection(c, ALL, undefined, 'yes')).toBe(true); // semua dicantumkan + auth siswa terverifikasi
    }
  });
  it('koleksi siswa-facing butuh NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED=yes; koleksi guru-saja tidak', () => {
    for (const c of STUDENT_FACING.filter((x) => !['students', 'student_login_codes', 'student_profiles'].includes(x))) {
      expect(isSupabaseCollection(c, c, undefined, undefined), c).toBe(false);
      expect(isSupabaseCollection(c, c, 'yes', undefined), `${c} override saja tidak cukup`).toBe(false);
      expect(isSupabaseCollection(c, c, undefined, 'yes'), c).toBe(true);
    }
    for (const c of ['session_skip_reasons', 'academic_years', 'class_fund_transactions', 'class_inventory', 'student_notes', 'journals']) {
      expect(STUDENT_FACING).not.toContain(c);
      expect(isSupabaseCollection(c, c, undefined, undefined), c).toBe(true);
    }
  });
  it('students + student_login_codes + student_profiles satu unit: tidak pernah menyala sendiri-sendiri', () => {
    const UNIT = ['students', 'student_login_codes', 'student_profiles'];
    for (const c of UNIT) {
      for (const partial of UNIT.filter((x) => x !== c)) {
        const flag = UNIT.filter((x) => x !== partial).join(',');
        expect(isSupabaseCollection(c, flag, undefined, 'yes'), `${c} tanpa ${partial}`).toBe(false);
      }
      expect(isSupabaseCollection(c, UNIT.join(','), undefined, 'yes')).toBe(true);
      expect(isSupabaseCollection(c, UNIT.join(','), undefined, undefined)).toBe(false);
    }
  });
  it('setiap koleksi siap punya pemetaan kolom di adapter', async () => {
    const { SUPABASE_MAPPED_COLLECTIONS } = await import('../lib/adapters/supabaseAdapter');
    for (const c of OFFLINE_PARITY_READY) expect(SUPABASE_MAPPED_COLLECTIONS).toContain(c);
  });
  it('override staging hanya membuka koleksi yang DICANTUMKAN, tidak koleksi lain', () => {
    expect(isSupabaseCollection(C, ` ${C} , x`, 'yes')).toBe(true);
    expect(isSupabaseCollection('students', C, 'yes')).toBe(false);
  });
});
