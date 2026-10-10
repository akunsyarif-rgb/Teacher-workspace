import { describe, expect, it } from 'vitest';
import { IDENTITY_UNIT, OFFLINE_PARITY_READY, STUDENT_FACING, isSupabaseCollection } from '../lib/config/dataBackend';

const C = 'session_skip_reasons';
const ID = 'workspaces,teacher_profiles';
// (koleksi, raw, override, studentAuth, teacherAuth)
const on = (c: string, raw: string, student?: string, teacher = 'yes') => isSupabaseCollection(c, raw, undefined, student, teacher);

describe('dataBackend flag', () => {
  it('default mati untuk semua koleksi, apa pun env verifikasi', () => {
    for (const c of OFFLINE_PARITY_READY) {
      expect(isSupabaseCollection(c, undefined, undefined, 'yes', 'yes'), c).toBe(false);
      expect(isSupabaseCollection(c, '', 'yes', 'yes', 'yes'), c).toBe(false);
    }
  });
  it('flag tanpa kesiapan offline TIDAK cukup (koleksi di luar daftar siap)', () => {
    expect(OFFLINE_PARITY_READY).not.toContain('payments');
    expect(OFFLINE_PARITY_READY).not.toContain('workspace_invites');
    expect(on('payments', `payments,${ID}`, 'yes')).toBe(false);
    expect(on('workspace_invites', `workspace_invites,${ID}`, 'yes')).toBe(false);
  });
  it('override staging membuka koleksi non-READY yang dicantumkan, tetapi tidak koleksi lain', () => {
    expect(isSupabaseCollection('payments', `payments,${ID}`, 'yes', 'yes', 'yes')).toBe(true);
    expect(isSupabaseCollection('journals', `payments,${ID}`, 'yes', 'yes', 'yes')).toBe(false);
  });
});

describe('unit identitas (workspaces + teacher_profiles)', () => {
  it('butuh keduanya dicantumkan DAN NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED=yes', () => {
    for (const c of IDENTITY_UNIT) {
      expect(on(c, ID), c).toBe(true);
      expect(on(c, ID, undefined, ''), `${c} tanpa auth guru`).toBe(false);
      expect(on(c, c), `${c} sendirian`).toBe(false);
      expect(on(c, 'teacher_profiles'.replace(c, ''), undefined)).toBe(false);
    }
  });
  it('identitas TIDAK memerlukan auth siswa (siswa tidak membaca workspaces/teacher_profiles)', () => {
    expect(STUDENT_FACING).not.toContain('workspaces');
    expect(STUDENT_FACING).not.toContain('teacher_profiles');
    expect(on('teacher_profiles', ID, undefined)).toBe(true);
  });
});

describe('koleksi data bergantung pada unit identitas', () => {
  it('tanpa unit identitas di Supabase, koleksi data apa pun tetap Firestore (RLS membutuhkan teacher_profiles)', () => {
    for (const c of OFFLINE_PARITY_READY.filter((x) => !IDENTITY_UNIT.includes(x))) {
      expect(on(c, [c, 'students', 'student_login_codes', 'student_profiles'].join(','), 'yes'), c).toBe(false);
      expect(on(c, `${c},workspaces`, 'yes'), `${c} + hanya workspaces`).toBe(false);
      expect(on(c, `${c},teacher_profiles`, 'yes'), `${c} + hanya teacher_profiles`).toBe(false);
    }
  });
  it('guru-saja menyala dengan identitas + auth guru; siswa-facing tambahan butuh auth siswa', () => {
    for (const c of ['session_skip_reasons', 'academic_years', 'class_fund_transactions', 'class_inventory', 'student_notes', 'journals']) {
      expect(STUDENT_FACING).not.toContain(c);
      expect(on(c, `${c},${ID}`, undefined), c).toBe(true);
      expect(on(c, `${c},${ID}`, undefined, ''), `${c} tanpa auth guru`).toBe(false);
    }
    for (const c of STUDENT_FACING.filter((x) => !['students', 'student_login_codes', 'student_profiles'].includes(x))) {
      expect(on(c, `${c},${ID}`, undefined), `${c} tanpa auth siswa`).toBe(false);
      expect(isSupabaseCollection(c, `${c},${ID}`, 'yes', undefined, 'yes'), `${c} override saja`).toBe(false);
      expect(on(c, `${c},${ID}`, 'yes'), c).toBe(true);
    }
  });
  it('students + student_login_codes + student_profiles satu unit: tidak pernah menyala sendiri-sendiri', () => {
    const UNIT = ['students', 'student_login_codes', 'student_profiles'];
    for (const c of UNIT) {
      for (const partial of UNIT.filter((x) => x !== c)) {
        const flag = [...UNIT.filter((x) => x !== partial), ...ID.split(',')].join(',');
        expect(on(c, flag, 'yes'), `${c} tanpa ${partial}`).toBe(false);
      }
      const all = [...UNIT, ...ID.split(',')].join(',');
      expect(on(c, all, 'yes')).toBe(true);
      expect(on(c, all, undefined), `${c} tanpa auth siswa`).toBe(false);
    }
  });
  it('setiap koleksi siap punya pemetaan kolom di adapter', async () => {
    const { SUPABASE_MAPPED_COLLECTIONS } = await import('../lib/adapters/supabaseAdapter');
    for (const c of OFFLINE_PARITY_READY) expect(SUPABASE_MAPPED_COLLECTIONS).toContain(c);
  });
  it('payments & workspace_invites sengaja bukan bagian migrasi', () => {
    expect(OFFLINE_PARITY_READY).not.toContain('payments');
    expect(OFFLINE_PARITY_READY).not.toContain('workspace_invites');
  });
  it('contoh C ikut: guru-saja + identitas lengkap = Supabase', () => {
    expect(on(C, `${C},${ID}`)).toBe(true);
  });
});
