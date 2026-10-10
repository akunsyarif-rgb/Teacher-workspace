import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repository dipakai nyata; kedua adapter diganti mock supaya terlihat siapa yang dipanggil.
const fs = vi.hoisted(() => ({ getDocuments: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn() }));
const sb = vi.hoisted(() => ({ getDocuments: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn() }));
vi.mock('../lib/adapters/firestoreAdapter', () => fs);
vi.mock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => sb }));

const C = 'session_skip_reasons';
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  // Koleksi data di Supabase mensyaratkan unit identitas + auth guru terverifikasi.
  const flag = env.NEXT_PUBLIC_SUPABASE_COLLECTIONS ? `${env.NEXT_PUBLIC_SUPABASE_COLLECTIONS},workspaces,teacher_profiles` : '';
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', flag);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED', flag ? 'yes' : '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE', 'yes');
  return import('../lib/repositories/sessionSkipReasonRepository');
}

beforeEach(() => {
  for (const m of [...Object.values(fs), ...Object.values(sb)]) m.mockReset();
  fs.getDocuments.mockResolvedValue([{ id: 'f1' }]);
  sb.getDocuments.mockResolvedValue([{ id: 's1' }]);
});

describe('sessionSkipReasonRepository — pemilihan backend', () => {
  it('default: Firestore untuk semua operasi, Supabase tidak tersentuh', async () => {
    const repo = await load({});
    await repo.getByDate('w', '2026-10-09');
    await repo.findByScheduleAndDate('w', 's', '2026-10-09');
    await repo.createSkipReason({ workspaceId: 'w' });
    await repo.updateSkipReason('id', { reason: 'x' });
    expect(fs.getDocuments).toHaveBeenCalledTimes(2);
    expect(fs.addDocument).toHaveBeenCalledWith(C, { workspaceId: 'w' });
    expect(fs.updateDocument).toHaveBeenCalledWith(C, 'id', { reason: 'x' });
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
  });
  it('flag dicantumkan: Supabase (koleksi ini sudah di OFFLINE_PARITY_READY)', async () => {
    const repo = await load({ NEXT_PUBLIC_SUPABASE_COLLECTIONS: C });
    expect(await repo.getByDate('w', 'd')).toEqual([{ id: 's1' }]);
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
  it('flag lain tidak memengaruhi koleksi ini', async () => {
    const repo = await load({ NEXT_PUBLIC_SUPABASE_COLLECTIONS: 'grades', NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE: 'yes' });
    await repo.getByDate('w', 'd');
    expect(sb.getDocuments).not.toHaveBeenCalled();
  });
  it('flag + override staging: Supabase dengan filter workspace; Firestore tidak dipanggil', async () => {
    const repo = await load({ NEXT_PUBLIC_SUPABASE_COLLECTIONS: C, NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE: 'yes' });
    expect(await repo.getByDate('w', '2026-10-09')).toEqual([{ id: 's1' }]);
    expect(sb.getDocuments).toHaveBeenCalledWith(C, [['workspaceId', '==', 'w'], ['date', '==', '2026-10-09']]);
    expect(await repo.findByScheduleAndDate('w', 'sch', 'd')).toEqual({ id: 's1' });
    await repo.createSkipReason({ workspaceId: 'w' });
    await repo.updateSkipReason('id', { reason: 'x' });
    expect(sb.addDocument).toHaveBeenCalled();
    expect(sb.updateDocument).toHaveBeenCalledWith(C, 'id', { reason: 'x' });
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
  it('kegagalan Supabase merambat ke pemanggil: TIDAK jatuh diam-diam ke Firestore dan tidak ditelan', async () => {
    const repo = await load({ NEXT_PUBLIC_SUPABASE_COLLECTIONS: C, NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE: 'yes' });
    sb.getDocuments.mockRejectedValue(new Error('offline'));
    sb.addDocument.mockRejectedValue(new Error('network'));
    await expect(repo.getByDate('w', 'd')).rejects.toThrow('offline');
    await expect(repo.createSkipReason({ workspaceId: 'w' })).rejects.toThrow('network');
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
  it('guard workspace kosong tetap berlaku di kedua backend', async () => {
    const repo = await load({ NEXT_PUBLIC_SUPABASE_COLLECTIONS: C, NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE: 'yes' });
    expect(await repo.getByDate('', 'd')).toEqual([]);
    expect(await repo.findByScheduleAndDate('w', '', 'd')).toBeNull();
    expect(sb.getDocuments).not.toHaveBeenCalled();
  });
});
