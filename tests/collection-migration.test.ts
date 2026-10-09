import { describe, expect, it } from 'vitest';
import { firestoreDocToRow, reconcileCollection } from '../lib/migration/collectionMigration';
import { fromRow } from '../lib/adapters/supabaseAdapter';

// Dokumen Firestore tipikal tiap koleksi (field sesuai payload service) → baris → kembali ke bentuk aplikasi.
const SAMPLES: Record<string, Record<string, unknown>> = {
  academic_years: { workspaceId: 'w', label: '2026/2027', startDate: '2026-07-13', endDate: null, isActive: true },
  class_fund_transactions: { workspaceId: 'w', className: '7A', type: 'masuk', amount: 15000.5, description: 'kas minggu 1', createdBy: 'u1' },
  class_inventory: { workspaceId: 'w', className: '7A', name: 'Sapu', quantity: 3, condition: 'baik', note: '' },
  student_notes: { workspaceId: 'w', className: '7A', category: 'konseling', studentId: 's1', studentName: 'Budi', title: 'T', notes: 'rahasia' },
  session_skip_reasons: { workspaceId: 'w', scheduleId: 'sc', className: '7A', date: '2026-10-09', reason: 'Rapat', note: '' },
};

describe.each(Object.entries(SAMPLES))('migrasi koleksi %s', (collection, data) => {
  it('semua field aplikasi bertahan (kolom + metadata) tanpa kehilangan', () => {
    const row = firestoreDocToRow(collection, 'id1', { ...data, createdAt: { seconds: 1760000000 } });
    const back = fromRow(collection, { ...row, updated_at: 'x' });
    for (const [k, v] of Object.entries(data)) expect(back[k], `${collection}.${k}`).toEqual(v);
  });
  it('rekonsiliasi bersih setelah round-trip (hasil PostgREST), terdeteksi bila satu field berbeda', () => {
    const row = firestoreDocToRow(collection, 'id1', data);
    expect(reconcileCollection(collection, [{ id: 'id1', data }], [{ ...row, created_at: 'z', updated_at: 'z' }]).ok).toBe(true);
    const key = Object.keys(data).find((k) => k !== 'workspaceId')!;
    const bad = reconcileCollection(collection, [{ id: 'id1', data: { ...data, [key]: 'BEDA-XYZ' } }], [row]);
    expect(bad.ok).toBe(false);
    expect(bad.mismatched).toHaveLength(1);
  });
});

it('koleksi tak dipetakan ditolak', () => {
  expect(() => firestoreDocToRow('grades', 'a', { workspaceId: 'w' })).toThrow(/belum dipetakan/);
});
