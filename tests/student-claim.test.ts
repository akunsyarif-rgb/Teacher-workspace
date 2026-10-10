import { beforeEach, describe, expect, it, vi } from 'vitest';

// Klaim kode akses siswa: Firestore (default) vs Supabase (RPC atomik claim_student_profile).
const fs = vi.hoisted(() => ({ getDocument: vi.fn(), getDocuments: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn(), batchWrite: vi.fn(), countDocuments: vi.fn(), generateId: vi.fn(), getDocumentFromCache: vi.fn() }));
const sb = vi.hoisted(() => ({ getDocument: vi.fn(), getDocuments: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn(), batchWrite: vi.fn(), countDocuments: vi.fn(), generateId: vi.fn(), getDocumentFromCache: vi.fn(), rpc: vi.fn() }));
vi.mock('../lib/adapters/firestoreAdapter', () => fs);
vi.mock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => sb }));

async function svc(flag: string, studentAuth = 'yes') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', flag ? `${flag},workspaces,teacher_profiles` : flag);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED', 'yes');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE', 'yes');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED', studentAuth);
  return import('../lib/services/studentAuthService');
}
const UNIT = 'students,student_login_codes,student_profiles';

beforeEach(() => { for (const m of [...Object.values(fs), ...Object.values(sb)]) m.mockReset(); });

describe('claimAccessCode', () => {
  it('default (Firestore): alur lama — baca kode login, tulis profil dengan accessCode', async () => {
    fs.getDocument.mockResolvedValue({ studentId: 's1', workspaceId: 'w', className: '7A', name: 'Budi', nis: '1' });
    const r = await (await svc('')).claimAccessCode(' abc123 ', 'uid1');
    expect(fs.getDocument).toHaveBeenCalledWith('student_login_codes', 'ABC123');
    expect(fs.batchWrite).toHaveBeenCalledWith([{ type: 'set', collectionName: 'student_profiles', id: 'uid1', data: expect.objectContaining({ accessCode: 'ABC123', studentId: 's1' }) }]);
    expect(r).toMatchObject({ id: 'uid1', studentId: 's1' });
    expect(sb.rpc).not.toHaveBeenCalled();
  });
  it('unit Supabase + auth siswa: SATU RPC claim_student_profile, Firestore tidak disentuh', async () => {
    sb.rpc.mockResolvedValue([{ student_id: 's1', workspace_id: 'w', class_name: '7A', name: 'Budi', nis: null }]);
    const r = await (await svc(UNIT)).claimAccessCode('abc123', 'uid1');
    expect(sb.rpc).toHaveBeenCalledWith('claim_student_profile', { p_code: 'ABC123' });
    expect(r).toEqual({ id: 'uid1', studentId: 's1', workspaceId: 'w', className: '7A', name: 'Budi', nis: '-' });
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
  it('kode tidak ada (P0002) → pesan Indonesia yang sama dengan alur lama', async () => {
    sb.rpc.mockRejectedValue(new Error('Supabase 404 P0002: invalid login code'));
    await expect((await svc(UNIT)).claimAccessCode('zzz', 'uid1')).rejects.toThrow('Kode akses tidak ditemukan');
  });
  it('error lain (jaringan/auth) TIDAK disamarkan dan TIDAK jatuh ke Firestore', async () => {
    sb.rpc.mockRejectedValue(new Error('Gagal menghubungi Supabase: fetch failed'));
    await expect((await svc(UNIT)).claimAccessCode('abc', 'uid1')).rejects.toThrow('fetch failed');
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
  it('respons RPC tidak lengkap → error, bukan profil kosong', async () => {
    sb.rpc.mockResolvedValue([]);
    await expect((await svc(UNIT)).claimAccessCode('abc', 'uid1')).rejects.toThrow(/tidak lengkap/);
  });
  it('unit tanpa verifikasi auth siswa → tetap Firestore', async () => {
    fs.getDocument.mockResolvedValue({ studentId: 's1', workspaceId: 'w', className: '7A', name: 'B' });
    await (await svc(UNIT, '')).claimAccessCode('abc', 'u');
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(fs.getDocument).toHaveBeenCalled();
  });
  it('profil dibaca/di-cache dari backend yang sama; warmup tidak menyentuh jaringan di Supabase', async () => {
    sb.getDocument.mockResolvedValue({ id: 'uid1' });
    sb.getDocumentFromCache.mockResolvedValue({ id: 'uid1', cached: true });
    const s = await svc(UNIT);
    expect(await s.getCurrentStudentProfile('uid1')).toEqual({ id: 'uid1' });
    expect(await s.getCachedStudentProfile('uid1')).toMatchObject({ cached: true });
    await s.warmupConnection();
    expect(sb.getDocument).toHaveBeenCalledTimes(1);
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
});
