import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/adapters/firestoreAdapter', () => ({}));
vi.mock('../lib/adapters/supabaseClient', () => ({ getSupabaseAdapter: () => ({}) }));
import { firestoreDocToRow, reconcileCollection } from '../lib/migration/collectionMigration';
import { fromRow } from '../lib/adapters/supabaseAdapter';

// Dokumen Firestore tipikal tiap koleksi (field sesuai payload service) → baris → kembali ke bentuk aplikasi.
const SAMPLES: Record<string, Record<string, unknown>> = {
  academic_years: { workspaceId: 'w', label: '2026/2027', startDate: '2026-07-13', endDate: null, isActive: true },
  class_fund_transactions: { workspaceId: 'w', className: '7A', type: 'masuk', amount: 15000.5, description: 'kas minggu 1', createdBy: 'u1' },
  class_inventory: { workspaceId: 'w', className: '7A', name: 'Sapu', quantity: 3, condition: 'baik', note: '' },
  student_notes: { workspaceId: 'w', className: '7A', category: 'konseling', studentId: 's1', studentName: 'Budi', title: 'T', notes: 'rahasia' },
  schedules: { workspaceId: 'w', className: '7A', day: 'Senin', timeSlot: '07:00-08:30', subject: 'IPA', teacherName: 'Bu Ani' },
  grade_columns: { workspaceId: 'w', className: '7A', title: 'UH 1', type: 'harian' },
  grades: { workspaceId: 'w', className: '7A', studentId: 's1', columnId: 'c1', score: '85' },
  student_achievements: { workspaceId: 'w', className: '7A', studentId: 's1', studentName: 'Budi', title: 'Juara', notes: '', date: '2026-10-01', migratedFromNoteId: 'n1' },
  journals: { workspaceId: 'w', className: '7A', date: '2026-10-09', teacherUid: 'u1', subject: 'IPA', scheduleId: 'sc', topic: 'Gaya', notes: 'ok' },
  attendances: { workspaceId: 'w', className: '7A', date: '2026-10-09', scheduleId: 'sc', records: [{ studentId: 's1', status: 'hadir' }, { studentId: 's2', status: 'sakit' }] },
  announcements: { workspaceId: 'w', className: '7A', title: 'Libur', body: 'Besok libur', date: '2026-10-09', subject: 'IPA' },
  assignments: { workspaceId: 'w', className: '7A', title: 'PR', description: 'hal 5', dueDate: '2026-10-20', subject: 'IPA', gradeColumnId: 'gc1', materialFileUrl: 'u', materialFileName: 'n.pdf', materialFilePath: 'p' },
  submissions: { workspaceId: 'w', className: '7A', assignmentId: 'a1', studentId: 's1', submittedAt: '2026-10-09T01:02:03.000Z', status: 'dinilai', score: 90, feedback: 'bagus', textAnswer: 'jawab', externalLink: { provider: 'google-drive', url: 'https://drive.google.com/x' }, attachments: [{ fileName: 'a.jpg', fileUrl: 'supabase-storage://submission-attachments/x', filePath: 'x' }] },
  students: { workspaceId: 'w', className: '7A', name: 'Budi', nis: '1001', accessCode: 'ABC123' },
  student_login_codes: { workspaceId: 'w', studentId: 's1', className: '7A', name: 'Budi', nis: '1001' },
  student_profiles: { workspaceId: 'w', studentId: 's1', className: '7A', name: 'Budi', nis: '1001', accessCode: 'ABC123' },
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
  expect(() => firestoreDocToRow('workspaces', 'a', { workspaceId: 'w' })).toThrow(/belum dipetakan/);
});

import { toMillis } from '../lib/repositories/gradeColumnRepository';
it('urutan kolom nilai tetap benar untuk createdAt ISO (Supabase) maupun Timestamp Firestore', () => {
  expect(toMillis('2026-10-09T00:00:01.000+00:00')).toBeGreaterThan(toMillis('2026-10-09T00:00:00.000+00:00'));
  expect(toMillis({ seconds: 10 })).toBe(10000);
  expect(toMillis({ toMillis: () => 5 })).toBe(5);
  expect(toMillis('bukan tanggal')).toBe(0);
  expect(toMillis(null)).toBe(0);
});

it('rekonsiliasi tidak false-positive: urutan key jsonb & format timestamp Postgres berbeda', () => {
  const data = SAMPLES.submissions;
  const row = firestoreDocToRow('submissions', 's1', data);
  const fromPg = {
    ...row,
    submitted_at: '2026-10-09T01:02:03+00:00', // format Postgres, bukan 'Z'
    external_link: { url: 'https://drive.google.com/x', provider: 'google-drive' }, // jsonb mengurutkan ulang key
    attachments: [{ filePath: 'x', fileUrl: 'supabase-storage://submission-attachments/x', fileName: 'a.jpg' }],
    score: 90,
  };
  expect(reconcileCollection('submissions', [{ id: 's1', data }], [fromPg]).ok).toBe(true);
  const bad = { ...fromPg, submitted_at: '2026-10-09T01:02:04+00:00' };
  expect(reconcileCollection('submissions', [{ id: 's1', data }], [bad]).mismatched[0].fields).toEqual(['submitted_at']);
});

it('kunci baris: student_profiles memakai user_id; kode login mengisi kolom code dari id', () => {
  const p = firestoreDocToRow('student_profiles', 'uid1', SAMPLES.student_profiles);
  expect(p).toMatchObject({ user_id: 'uid1', workspace_id: 'w', student_id: 's1' });
  expect('id' in p).toBe(false);
  expect(reconcileCollection('student_profiles', [{ id: 'uid1', data: SAMPLES.student_profiles }], [p]).ok).toBe(true);
  expect(firestoreDocToRow('student_login_codes', 'ABC123', SAMPLES.student_login_codes)).toMatchObject({ id: 'ABC123', code: 'ABC123' });
});
