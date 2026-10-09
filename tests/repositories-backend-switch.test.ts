import { beforeEach, describe, expect, it, vi } from 'vitest';

// Lima repository yang bisa dialihkan: default Firestore, Supabase hanya bila koleksinya dicantumkan di flag.
const fs = vi.hoisted(() => ({ getDocuments: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn() }));
const sb = vi.hoisted(() => ({ getDocuments: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn() }));
vi.mock('../lib/adapters/firestoreAdapter', () => fs);
vi.mock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => sb }));

const CASES: { collection: string; mod: string; run: (r: Record<string, (...a: unknown[]) => Promise<unknown>>) => Promise<unknown>[] }[] = [
  { collection: 'academic_years', mod: 'academicYearRepository', run: (r) => [r.listByWorkspace('w'), r.getActive('w'), r.create({ workspaceId: 'w' }), r.update('i', { label: 'x' })] },
  { collection: 'class_fund_transactions', mod: 'classFundRepository', run: (r) => [r.getTransactions('w', '7A'), r.createTransaction({ workspaceId: 'w' }), r.deleteTransaction('i')] },
  { collection: 'class_inventory', mod: 'inventoryRepository', run: (r) => [r.getItems('w', '7A'), r.createItem({ workspaceId: 'w' }), r.updateItem('i', {}), r.deleteItem('i')] },
  { collection: 'student_notes', mod: 'studentNoteRepository', run: (r) => [r.getNotes('w', '7A', 'konseling'), r.createNote({ workspaceId: 'w' }), r.deleteNote('i')] },
  { collection: 'session_skip_reasons', mod: 'sessionSkipReasonRepository', run: (r) => [r.getByDate('w', 'd'), r.createSkipReason({ workspaceId: 'w' }), r.updateSkipReason('i', {})] },
];

async function load(mod: string, flag: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_COLLECTIONS', flag);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE', '');
  return (await import(`../lib/repositories/${mod}.ts`)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
}
beforeEach(() => {
  for (const m of [...Object.values(fs), ...Object.values(sb)]) m.mockReset().mockResolvedValue([]);
});

describe.each(CASES)('$mod ($collection)', ({ collection, mod, run }) => {
  it('default: seluruh operasi ke Firestore, Supabase tidak tersentuh', async () => {
    await Promise.all(run(await load(mod, '')));
    expect(Object.values(fs).some((m) => m.mock.calls.length > 0)).toBe(true);
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
    for (const m of Object.values(fs)) for (const call of m.mock.calls) expect(call[0]).toBe(collection);
  });
  it('flag koleksi lain: tetap Firestore', async () => {
    await Promise.all(run(await load(mod, 'grades,journals')));
    for (const m of Object.values(sb)) expect(m).not.toHaveBeenCalled();
  });
  it('flag koleksi ini: seluruh operasi ke Supabase, Firestore tidak tersentuh; query selalu memuat workspaceId', async () => {
    await Promise.all(run(await load(mod, collection)));
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
    for (const call of sb.getDocuments.mock.calls) expect((call[1] as unknown[][]).some((f) => f[0] === 'workspaceId')).toBe(true);
  });
  it('kegagalan Supabase merambat (tidak jatuh ke Firestore, tidak ditelan)', async () => {
    for (const m of Object.values(sb)) m.mockRejectedValue(new Error('gagal-sb'));
    const results = await Promise.allSettled(run(await load(mod, collection)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const m of Object.values(fs)) expect(m).not.toHaveBeenCalled();
  });
});
