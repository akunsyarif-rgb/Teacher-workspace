import { describe, it, expect, beforeEach } from 'vitest';
import { setPersistentStorageForTests, clearPersistentData } from '@/lib/utils/persistentCache';
import {
  formDraftKey, saveFormDraft, loadFormDraft, removeFormDraft, countFormDrafts, countUnsavedDrafts, FORM_DRAFT_TTL_MS,
} from '@/lib/utils/formDraft';
import { saveGradeDraft, buildDraft } from '@/lib/utils/gradeDraft';

function mem(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear() } as Storage;
}
beforeEach(() => setPersistentStorageForTests(mem()));

describe('draf formulir', () => {
  it('simpan → muat → hapus', () => {
    const k = formDraftKey('jurnal', 'ws', 'X-1', null, '2026-11-11');
    expect(k).toBe('form-draft:jurnal:ws:X-1:-:2026-11-11');
    saveFormDraft(k, { topic: 'a', notes: 'b' });
    expect(loadFormDraft(k)).toEqual({ topic: 'a', notes: 'b' });
    removeFormDraft(k);
    expect(loadFormDraft(k)).toBeUndefined();
  });

  it('kunci berbeda per konteks tidak saling menimpa', () => {
    saveFormDraft(formDraftKey('pengumuman', 'ws', 'X-1'), { t: 1 });
    saveFormDraft(formDraftKey('pengumuman', 'ws', 'X-2'), { t: 2 });
    expect(loadFormDraft(formDraftKey('pengumuman', 'ws', 'X-1'))).toEqual({ t: 1 });
    expect(loadFormDraft(formDraftKey('pengumuman', 'ws', 'X-2'))).toEqual({ t: 2 });
  });

  it('draf >30 hari diabaikan dan tidak dihitung', () => {
    const store = mem();
    setPersistentStorageForTests(store);
    const k = formDraftKey('tugas', 'ws', 'X-1');
    store.setItem('tw:sync:v1:' + k, JSON.stringify({ t: Date.now() - FORM_DRAFT_TTL_MS - 1000, v: { a: 1 } }));
    expect(loadFormDraft(k)).toBeUndefined();
    expect(countFormDrafts()).toBe(0);
  });

  it('countUnsavedDrafts menjumlah draf nilai + formulir; nol setelah keluar akun', () => {
    saveFormDraft(formDraftKey('jawaban', 'ws', 's1', 'a1'), { answer: 'x' });
    saveGradeDraft('ws', 'X-1', buildDraft({ s1: { c1: '9' } }, {}));
    expect(countUnsavedDrafts()).toBe(2);
    clearPersistentData();
    expect(countUnsavedDrafts()).toBe(0);
  });

  it('penyimpanan tidak tersedia: tidak error', () => {
    setPersistentStorageForTests(null);
    expect(() => saveFormDraft('form-draft:x', { a: 1 })).not.toThrow();
    expect(loadFormDraft('form-draft:x')).toBeUndefined();
    expect(countUnsavedDrafts()).toBe(0);
  });
});
