import { describe, it, expect, beforeEach } from 'vitest';
import { setPersistentStorageForTests, clearPersistentData } from '@/lib/utils/persistentCache';
import {
  buildDraft, restoreDraft, saveGradeDraft, loadGradeDraft, countGradeDrafts, gradeDraftKey, GRADE_DRAFT_TTL_MS,
} from '@/lib/utils/gradeDraft';

function mem(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear() } as Storage;
}
beforeEach(() => setPersistentStorageForTests(mem()));

const ids = new Set(['s1', 's2']);
const cols = new Set(['c1', 'c2']);

describe('draf nilai', () => {
  it('buildDraft hanya memuat sel yang berubah, dan null bila tidak ada perubahan', () => {
    const saved = { s1: { c1: '80' } };
    expect(buildDraft({ s1: { c1: '80' } }, saved)).toBeNull();
    const d = buildDraft({ s1: { c1: '90', c2: '70' }, s2: { c1: '' } }, saved)!;
    expect(d.cells).toEqual({ s1: { c1: { value: '90', base: '80' }, c2: { value: '70', base: '' } } });
  });

  it('draf bertahan setelah "reload": simpan → muat → pulihkan semua nilai', () => {
    const grades = { s1: { c1: '75' }, s2: { c1: '60', c2: '88' } };
    saveGradeDraft('ws', 'X-1', buildDraft(grades, {}));
    const draft = loadGradeDraft('ws', 'X-1')!;
    const r = restoreDraft(draft, {}, ids, cols);
    expect(r.grades).toEqual(grades);
    expect(r.restored).toBe(3);
    expect(r.conflicts).toBe(0);
    expect(r.unlock).toEqual([]);
  });

  it('sel yang mengoreksi nilai tersimpan dibuka kuncinya', () => {
    const draft = buildDraft({ s1: { c1: '95' } }, { s1: { c1: '80' } })!;
    const r = restoreDraft(draft, { s1: { c1: '80' } }, ids, cols);
    expect(r.grades.s1.c1).toBe('95');
    expect(r.unlock).toEqual([{ studentId: 's1', columnId: 'c1' }]);
  });

  it('konflik: nilai tersimpan berubah sejak draf dibuat → tidak ditimpa', () => {
    const draft = buildDraft({ s1: { c1: '95' } }, { s1: { c1: '80' } })!;
    const r = restoreDraft(draft, { s1: { c1: '85' } }, ids, cols);
    expect(r.grades.s1.c1).toBe('85');
    expect(r.conflicts).toBe(1);
    expect(r.restored).toBe(0);
  });

  it('siswa/kolom yang sudah dihapus dilewati', () => {
    const draft = buildDraft({ s9: { c1: '1' }, s1: { c9: '2' }, s2: { c1: '3' } }, {})!;
    const r = restoreDraft(draft, {}, ids, cols);
    expect(r.restored).toBe(1);
    expect(r.grades).toEqual({ s2: { c1: '3' } });
  });

  it('draf kedaluwarsa (>30 hari) tidak dimuat; penyimpanan null tidak error', () => {
    const store = mem();
    setPersistentStorageForTests(store);
    const draft = buildDraft({ s1: { c1: '1' } }, {});
    store.setItem('tw:sync:v1:' + gradeDraftKey('ws', 'X-1'), JSON.stringify({ t: Date.now() - GRADE_DRAFT_TTL_MS - 1000, v: draft }));
    expect(loadGradeDraft('ws', 'X-1')).toBeUndefined();
    store.setItem('tw:sync:v1:' + gradeDraftKey('ws', 'X-1'), JSON.stringify({ t: Date.now() - 1000, v: draft }));
    expect(loadGradeDraft('ws', 'X-1')).toEqual(draft);
    setPersistentStorageForTests(null);
    expect(() => saveGradeDraft('ws', 'X-1', draft)).not.toThrow();
    expect(loadGradeDraft('ws', 'X-1')).toBeUndefined();
  });

  it('countGradeDrafts menghitung per kelas; hilang setelah Simpan (null) dan setelah keluar akun', () => {
    saveGradeDraft('ws', 'X-1', buildDraft({ s1: { c1: '1' } }, {}));
    saveGradeDraft('ws', 'X-2', buildDraft({ s1: { c1: '1' } }, {}));
    expect(countGradeDrafts()).toBe(2);
    saveGradeDraft('ws', 'X-1', null);
    expect(countGradeDrafts()).toBe(1);
    clearPersistentData();
    expect(countGradeDrafts()).toBe(0);
  });
});
