import { describe, it, expect } from 'vitest';
import { firestoreDocToRow, reconcileSkipReasons } from '../lib/migration/skipReasonsMigration';

const doc = { workspaceId: 'w', scheduleId: 's1', className: '7A', date: '2026-10-09', reason: 'sakit', note: 'x', createdAt: { seconds: 1760000000 } };

describe('firestoreDocToRow', () => {
  it('pertahankan id & timestamp, scheduleId/note ke metadata', () => {
    const row = firestoreDocToRow('abc', doc);
    expect(row).toMatchObject({ id: 'abc', workspace_id: 'w', class_name: '7A', date: '2026-10-09', reason: 'sakit', metadata: { scheduleId: 's1', note: 'x' } });
    expect(row.created_at).toBe(new Date(1760000000 * 1000).toISOString());
  });
  it.each([
    ['Timestamp.toDate', { toDate: () => new Date('2026-01-02T03:04:05.000Z') }, '2026-01-02T03:04:05.000Z'],
    ['_seconds (Admin SDK JSON)', { _seconds: 1760000000 }, new Date(1760000000000).toISOString()],
    ['ISO string', '2026-01-02T03:04:05Z', '2026-01-02T03:04:05.000Z'],
    ['Date', new Date('2026-01-02T00:00:00Z'), '2026-01-02T00:00:00.000Z'],
  ])('timestamp %s', (_n, input, out) => {
    expect(firestoreDocToRow('a', { ...doc, createdAt: input }).created_at).toBe(out);
  });
  it('timestamp rusak/kosong tidak melempar & tidak menulis created_at', () => {
    const r = firestoreDocToRow('a', { ...doc, createdAt: 'bukan tanggal' });
    expect('created_at' in r).toBe(false);
    expect('created_at' in firestoreDocToRow('a', { ...doc, createdAt: undefined })).toBe(false);
  });
  it('tolak dokumen tanpa workspaceId / id', () => {
    expect(() => firestoreDocToRow('z', { reason: 'x' })).toThrow();
    expect(() => firestoreDocToRow('', doc)).toThrow();
    expect(() => firestoreDocToRow('z', { ...doc, workspaceId: 5 })).toThrow();
  });
});

describe('reconcileSkipReasons', () => {
  const sbRow = (id: string, over: Record<string, unknown> = {}) => ({ ...firestoreDocToRow(id, doc), ...over });

  it('cocok penuh', () => {
    expect(reconcileSkipReasons([{ id: 'a', data: doc }], [sbRow('a')])).toMatchObject({ ok: true, matched: 1 });
  });
  it('kosong vs kosong = bersih', () => {
    expect(reconcileSkipReasons([], []).ok).toBe(true);
  });
  it('deteksi hilang, berlebih, dan beda field', () => {
    const r = reconcileSkipReasons(
      [{ id: 'a', data: doc }, { id: 'b', data: doc }],
      [sbRow('a', { reason: 'izin' }), sbRow('c')]
    );
    expect(r.ok).toBe(false);
    expect(r.missingInSupabase).toEqual(['b']);
    expect(r.extraInSupabase).toEqual(['c']);
    expect(r.mismatched).toEqual([{ id: 'a', fields: ['reason'] }]);
  });
  it('beda isi metadata (field tak berkolom) terdeteksi', () => {
    const r = reconcileSkipReasons([{ id: 'a', data: doc }], [sbRow('a', { metadata: { scheduleId: 's1', note: 'BEDA' } })]);
    expect(r.mismatched).toEqual([{ id: 'a', fields: ['metadata'] }]);
  });
  it('TIDAK false positive: timestamp beda presisi, urutan key metadata, null vs undefined, hasil PostgREST', () => {
    const fromPostgrest = {
      id: 'a', workspace_id: 'w', class_name: '7A', teacher_uid: null, date: '2026-10-09', reason: 'sakit',
      metadata: { note: 'x', scheduleId: 's1' }, // urutan key terbalik
      created_at: '2030-01-01T00:00:00.123456+00:00', updated_at: '2031-01-01T00:00:00+00:00', // beda total
    };
    expect(reconcileSkipReasons([{ id: 'a', data: doc }], [fromPostgrest]).ok).toBe(true);
    const noMeta = { id: 'n', workspace_id: 'w', class_name: null, teacher_uid: null, date: null, reason: null, metadata: null };
    expect(reconcileSkipReasons([{ id: 'n', data: { workspaceId: 'w' } }], [noMeta]).ok).toBe(true);
  });
  it('ID duplikat di Supabase atau Firestore → tidak bersih', () => {
    expect(reconcileSkipReasons([{ id: 'a', data: doc }], [sbRow('a'), sbRow('a')]).duplicateIds).toEqual(['a']);
    const r = reconcileSkipReasons([{ id: 'a', data: doc }, { id: 'a', data: doc }], [sbRow('a')]);
    expect(r.duplicateIds).toEqual(['a']);
    expect(r.ok).toBe(false);
  });
  it('dokumen Firestore tak valid dilaporkan, bukan dianggap hilang', () => {
    const r = reconcileSkipReasons([{ id: 'bad', data: { reason: 'x' } }], []);
    expect(r.invalidDocs).toEqual(['bad']);
    expect(r.missingInSupabase).toEqual([]);
    expect(r.ok).toBe(false);
  });
});
