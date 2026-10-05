import { describe, expect, it } from 'vitest';
import * as mapping from '../scripts/migration/mapping.mjs';

// Modul .mjs murni tanpa deklarasi tipe — di-cast supaya tsc tidak rewel.
/* eslint-disable @typescript-eslint/no-explicit-any */
const { TABLES, mapDoc, validateAll } = mapping as any;

// Pemetaan Firestore -> Supabase harus lossless & mendeteksi data yatim
// SEBELUM ada penulisan apa pun ke produksi.

const spec = (c: string) => TABLES.find((t: { c: string }) => t.c === c);

describe('mapDoc', () => {
  it('camelCase -> snake_case, ID dokumen jadi primary key', () => {
    const row = mapDoc(spec('schedules'), 's1', {
      workspaceId: 'w1', className: 'X-1', timeSlot: '07.00-07.45', teacherName: 'Budi', date: '2026-08-11',
    });
    expect(row).toMatchObject({ id: 's1', workspace_id: 'w1', class_name: 'X-1', time_slot: '07.00-07.45', teacher_name: 'Budi', date: '2026-08-11' });
  });

  it('timestamp asli Firestore dijaga (created_at/updated_at)', () => {
    const row = mapDoc(spec('students'), 'a', {
      workspaceId: 'w1', className: 'X', createdAt: { _seconds: 1_700_000_000, _nanoseconds: 0 },
      updatedAt: { toDate: () => new Date('2025-01-02T03:04:05.000Z') },
    });
    expect(row.created_at).toBe('2023-11-14T22:13:20.000Z');
    expect(row.updated_at).toBe('2025-01-02T03:04:05.000Z');
  });

  it('tanpa timestamp -> kolom dibuang supaya default DB (now()) yang berlaku', () => {
    const row = mapDoc(spec('students'), 'a', { workspaceId: 'w1', className: 'X' });
    expect('created_at' in row).toBe(false);
    expect('updated_at' in row).toBe(false);
  });

  it('field tanpa kolom khusus masuk metadata, tidak hilang', () => {
    const row = mapDoc(spec('journals'), 'j1', { workspaceId: 'w1', className: 'X', topic: 'Aljabar', materials: ['a', 'b'] });
    expect(row.metadata).toEqual({ topic: 'Aljabar', materials: ['a', 'b'] });
  });

  it('tanggal Timestamp dikonversi ke tanggal dinding WITA, bukan UTC', () => {
    // 23.30 UTC tgl 10 = 07.30 WITA tgl 11
    const row = mapDoc(spec('journals'), 'j', { workspaceId: 'w', date: { _seconds: Date.parse('2026-08-10T23:30:00Z') / 1000 } });
    expect(row.date).toBe('2026-08-11');
  });

  it('nilai tak bisa dikonversi -> NULL + nilai asli tersimpan di metadata.__unparsed', () => {
    const row = mapDoc(spec('grades'), 'g', { workspaceId: 'w', studentId: 's', columnId: 'c', score: 'abc' });
    expect(row.score).toBeNull();
    expect(row.metadata.__unparsed).toEqual({ score: 'abc' });
  });

  it('string angka & kosong ditangani', () => {
    expect(mapDoc(spec('grades'), 'g', { workspaceId: 'w', score: '85.5' }).score).toBe(85.5);
    expect(mapDoc(spec('grades'), 'g', { workspaceId: 'w', score: '' }).score).toBeNull();
  });

  it('epoch ms pada kolom bigint tetap utuh', () => {
    const row = mapDoc(spec('workspaces'), 'w', { ownerUid: 'u', inviteCodeExpiresAt: 1_800_000_000_000, planExpiresAt: null });
    expect(row.invite_code_expires_at).toBe(1_800_000_000_000);
    expect(row.plan_expires_at).toBeNull();
  });

  it('is_active tidak pernah NULL (kolom NOT NULL)', () => {
    expect(mapDoc(spec('academic_years'), 'y', { workspaceId: 'w' }).is_active).toBe(false);
    expect(mapDoc(spec('academic_years'), 'y', { workspaceId: 'w', isActive: true }).is_active).toBe(true);
  });

  it('submission: externalLink & attachments dibawa utuh', () => {
    const row = mapDoc(spec('submissions'), 'a_s', {
      workspaceId: 'w', assignmentId: 'a', studentId: 's',
      externalLink: { provider: 'google-drive', url: 'https://drive.google.com/x' },
      attachments: [{ name: 'f.pdf', url: 'u' }],
    });
    expect(row.external_link).toEqual({ provider: 'google-drive', url: 'https://drive.google.com/x' });
    expect(row.attachments).toEqual([{ name: 'f.pdf', url: 'u' }]);
  });
});

describe('validateAll', () => {
  const base = () => ({
    workspaces: [mapDoc(spec('workspaces'), 'w', { ownerUid: 'u' })],
    students: [mapDoc(spec('students'), 's1', { workspaceId: 'w', className: 'X' })],
    grade_columns: [mapDoc(spec('grade_columns'), 'c1', { workspaceId: 'w', className: 'X' })],
    grades: [mapDoc(spec('grades'), 'c1_s1', { workspaceId: 'w', studentId: 's1', columnId: 'c1', score: 90 })],
  });

  it('data bersih -> tanpa masalah', () => {
    expect(validateAll(base())).toEqual([]);
  });

  it('mendeteksi FK yatim (nilai milik siswa yang sudah dihapus)', () => {
    const d = base();
    d.grades.push(mapDoc(spec('grades'), 'c1_gone', { workspaceId: 'w', studentId: 'gone', columnId: 'c1', score: 1 }));
    const p = validateAll(d);
    expect(p).toContainEqual(expect.objectContaining({ c: 'grades', id: 'c1_gone', kind: 'FK_ORPHAN' }));
  });

  it('mendeteksi NOT NULL (siswa tanpa className)', () => {
    const d = base();
    d.students.push(mapDoc(spec('students'), 's2', { workspaceId: 'w' }));
    expect(validateAll(d)).toContainEqual(expect.objectContaining({ c: 'students', id: 's2', kind: 'NOT_NULL', detail: 'class_name' }));
  });

  it('mendeteksi duplikat (workspace, siswa, kolom) pada nilai', () => {
    const d = base();
    d.grades.push(mapDoc(spec('grades'), 'dupe', { workspaceId: 'w', studentId: 's1', columnId: 'c1', score: 70 }));
    expect(validateAll(d)).toContainEqual(expect.objectContaining({ c: 'grades', id: 'dupe', kind: 'DUPLICATE' }));
  });

  it('melaporkan nilai yang gagal dikonversi', () => {
    const d = base();
    d.grades.push(mapDoc(spec('grades'), 'bad', { workspaceId: 'w', studentId: 's1', columnId: 'c9', score: 'x' }));
    expect(validateAll(d).map((p: { kind: string }) => p.kind)).toContain('UNPARSED_VALUE');
  });
});
