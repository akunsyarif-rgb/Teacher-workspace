import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RecycleBinView, { type RecycleBinViewProps } from '../src/components/recyclebin/RecycleBinView';
import type { BinItem } from '../lib/controllers/recycleBinController';

// Aturan tampilan: tombol "Hapus Permanen" dan "Kosongkan Sampah" HANYA untuk OWNER/ADMIN (canPurge).
const item = (kind: BinItem['kind'], id: string, title: string, extra: Partial<BinItem> = {}): BinItem => ({
  key: `${kind}:${id}`, kind, id, title, detail: 'Siswa · Kelas 7A', className: '7A', deletedAt: 1_700_000_000_000, deletedBy: 'u1', createdBy: 'u1', ...extra,
});
const ITEMS = [item('student', 's1', 'Ani'), item('assignment', 'a1', 'Tugas 1'), item('class', '8C', 'Kelas 8C', { count: 3, detail: '3 siswa' })];

const base = (over: Partial<RecycleBinViewProps> = {}): RecycleBinViewProps => ({
  items: ITEMS,
  counts: { all: 3, class: 1, student: 1, assignment: 1, column: 0 },
  filter: 'all', loading: false, uid: 'u1', busyKey: null, canPurge: false, notice: '', error: '',
  onFilter: vi.fn(), onDismissError: vi.fn(), onRestore: vi.fn(), onPurge: vi.fn(), onEmpty: vi.fn(),
  ...over,
});
const html = (over: Partial<RecycleBinViewProps> = {}) => renderToStaticMarkup(createElement(RecycleBinView, base(over)));

describe('guru biasa (canPurge=false): tidak ada akses hapus permanen sama sekali', () => {
  const out = html({ canPurge: false });
  it('tidak ada tombol "Hapus Permanen" maupun "Kosongkan Sampah" di markup', () => {
    expect(out).not.toMatch(/Hapus Permanen/i);
    expect(out).not.toMatch(/Hapus permanen/);
    expect(out).not.toMatch(/Kosongkan Sampah/i);
  });
  it('tetap bisa memulihkan; teks bantuan tidak menawarkan hapus permanen', () => {
    expect((out.match(/Pulihkan /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(out).toMatch(/Guru biasa hanya melihat item yang ia buat sendiri/);
    expect(out).not.toMatch(/tidak dapat dibatalkan/);
  });
});

describe('OWNER/ADMIN (canPurge=true)', () => {
  it('tombol Hapus Permanen per item (aria-label bernama) + Kosongkan Sampah', () => {
    const out = html({ canPurge: true });
    for (const title of ['Ani', 'Tugas 1', 'Kelas 8C']) expect(out).toContain(`aria-label="Hapus permanen ${title}"`);
    expect((out.match(/>Hapus Permanen</g) ?? []).length).toBe(3);
    expect(out).toContain('Kosongkan Sampah');
    expect(out).toMatch(/tidak dapat dibatalkan/);
  });

  it('Kosongkan Sampah tersembunyi bila Sampah kosong; keadaan kosong tampil', () => {
    const out = html({ canPurge: true, items: [], counts: { all: 0, class: 0, student: 0, assignment: 0, column: 0 } });
    expect(out).not.toContain('Kosongkan Sampah');
    expect(out).not.toMatch(/Hapus Permanen/);
    expect(out).toContain('Sampah kosong');
  });

  it('saat ada proses berjalan (busyKey) semua tombol aksi dinonaktifkan', () => {
    const out = html({ canPurge: true, busyKey: 'student:s1' });
    const buttons = out.match(/<button[^>]*aria-label="(Pulihkan|Hapus permanen)[^>]*>/g) ?? [];
    expect(buttons.length).toBe(6);
    for (const b of buttons) expect(b).toContain('disabled');
    expect(out).toMatch(/Kosongkan Sampah/);
  });
});

describe('keadaan lain', () => {
  it('memuat: spinner, tanpa daftar', () => {
    const out = html({ loading: true, items: [] });
    expect(out).toContain('Memuat Sampah');
    expect(out).not.toContain('data-testid="bin-item"');
  });
  it('pesan sukses dan galat ditampilkan; galat tidak membocorkan apa pun selain pesan yang diberikan', () => {
    const out = html({ notice: 'Ani dihapus permanen.', error: 'Anda tidak punya izin.' });
    expect(out).toContain('Ani dihapus permanen.');
    expect(out).toContain('Anda tidak punya izin.');
  });
  it('baris menyebut "oleh Anda" hanya untuk penghapus yang sama', () => {
    expect(html({ uid: 'u1' })).toContain('oleh Anda');
    expect(html({ uid: 'orang-lain' })).not.toContain('oleh Anda');
  });
});
