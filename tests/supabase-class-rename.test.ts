import { describe, expect, it } from 'vitest';
import { renameClassInSupabase, supabaseCollectionsToRename } from '../lib/server/supabaseClassRename';
import { createFakePostgrest } from './helpers/fakePostgrest';

const row = (id: string, ws: string, cls: string) => ({ id, workspace_id: ws, class_name: cls, metadata: {} });

describe('supabaseCollectionsToRename', () => {
  it('default: tidak ada koleksi (semua Firestore)', () => {
    expect(supabaseCollectionsToRename(undefined, undefined)).toEqual([]);
  });
  it('hanya koleksi berflag yang punya class_name; academic_years dilewati', () => {
    expect(supabaseCollectionsToRename('session_skip_reasons,academic_years,grades', undefined).sort()).toEqual(['session_skip_reasons']);
  });
});

describe('renameClassInSupabase', () => {
  const mk = (rows: ReturnType<typeof row>[]) => createFakePostgrest({ tokens: { svc: 'wsA' }, rows });
  const run = (fake: ReturnType<typeof mk>, over = {}) =>
    renameClassInSupabase({ workspaceId: 'wsA', oldName: '7A', newName: '7B', collections: ['session_skip_reasons'], url: 'https://x.supabase.co/rest/v1/', secretKey: 'svc', fetchImpl: fake.fetchImpl, ...over });

  it('tanpa koleksi berflag: tidak ada request, tidak butuh env', async () => {
    const fake = mk([]);
    expect(await renameClassInSupabase({ workspaceId: 'wsA', oldName: '7A', newName: '7B', collections: [], fetchImpl: fake.fetchImpl })).toEqual({});
    expect(fake.log).toHaveLength(0);
  });
  it('hanya baris workspace + kelas lama yang berubah; jumlah dilaporkan', async () => {
    const fake = mk([row('1', 'wsA', '7A'), row('2', 'wsA', '7A'), row('3', 'wsA', '8C'), row('4', 'wsB', '7A')]);
    expect(await run(fake)).toEqual({ session_skip_reasons: 2 });
    expect(fake.store.get('1')).toMatchObject({ class_name: '7B' });
    expect(fake.store.get('3')).toMatchObject({ class_name: '8C' });
    expect(fake.store.get('4')).toMatchObject({ class_name: '7A' }); // workspace lain tak tersentuh
  });
  it('gagal → error yang menyebut koleksi dan apa yang sudah berubah (tidak diam-diam)', async () => {
    const fake = createFakePostgrest({ tokens: { svc: 'wsA' }, rows: [row('1', 'wsA', '7A')], intercept: ({ url }) => (url.pathname.endsWith('class_inventory') ? { status: 500, body: {} } : undefined) });
    await expect(run(fake, { collections: ['session_skip_reasons', 'class_inventory'] })).rejects.toThrow(/class_inventory.*session_skip_reasons:1/);
  });
  it('env server kurang → error jelas bila ada koleksi berflag', async () => {
    await expect(renameClassInSupabase({ workspaceId: 'w', oldName: 'a', newName: 'b', collections: ['class_inventory'], url: '', secretKey: '' })).rejects.toThrow(/Konfigurasi Supabase server/);
  });
});
