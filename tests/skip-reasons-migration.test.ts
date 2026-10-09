import { describe, it, expect } from 'vitest';
import { firestoreDocToRow, reconcileSkipReasons } from '../lib/migration/skipReasonsMigration';

const doc = { workspaceId: 'w', scheduleId: 's1', className: '7A', date: '2026-10-09', reason: 'sakit', note: 'x', createdAt: { seconds: 1760000000 } };

describe('firestoreDocToRow', () => {
  it('pertahankan id & timestamp, scheduleId/note ke metadata', () => {
    const row = firestoreDocToRow('abc', doc);
    expect(row).toMatchObject({ id: 'abc', workspace_id: 'w', class_name: '7A', date: '2026-10-09', reason: 'sakit', metadata: { scheduleId: 's1', note: 'x' } });
    expect(row.created_at).toBe(new Date(1760000000 * 1000).toISOString());
  });
  it('tolak dokumen tanpa workspaceId', () => {
    expect(() => firestoreDocToRow('z', { reason: 'x' })).toThrow();
  });
});

describe('reconcileSkipReasons', () => {
  const sbRow = (id: string, over = {}) => ({ ...firestoreDocToRow(id, doc), ...over });
  it('cocok penuh', () => {
    expect(reconcileSkipReasons([{ id: 'a', data: doc }], [sbRow('a')])).toMatchObject({ ok: true, matched: 1 });
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
});
