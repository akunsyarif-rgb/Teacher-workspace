import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createPersistentStore,
  setPersistentStorageForTests,
  withPersistentCache,
  derivedCache,
  syncStore,
  clearPersistentData,
} from '@/lib/utils/persistentCache';
import { clearAllCached } from '@/lib/utils/sessionCache';
import { planSync, mergeWindow, buildFullState, reduceToStudent } from '@/lib/utils/attendanceSync';
import { summarizeAttendance } from '@/lib/utils/studentStats';
import { shiftWitaDateString } from '@/lib/utils/witaDate';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

beforeEach(() => setPersistentStorageForTests(memoryStorage()));

describe('persistentCache', () => {
  it('clearPersistentData (keluar akun) menghapus cache turunan DAN sinkron', () => {
    derivedCache.set('a', 1);
    syncStore.set('b', 2);
    clearPersistentData();
    expect(derivedCache.get('a')).toBeUndefined();
    expect(syncStore.get('b')).toBeUndefined();
  });
  it('menghormati TTL', () => {
    const s = createPersistentStore('x:');
    s.set('a', { n: 1 }, 1000);
    expect(s.get('a', 500, 1400)).toEqual({ n: 1 });
    expect(s.get('a', 500, 1600)).toBeUndefined();
  });
  it('no-op aman bila penyimpanan tidak tersedia', async () => {
    setPersistentStorageForTests(null);
    const fetcher = vi.fn().mockResolvedValue(5);
    expect(await withPersistentCache('k', 1000, fetcher)).toBe(5);
    expect(await withPersistentCache('k', 1000, fetcher)).toBe(5);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('withPersistentCache memakai ulang hasil; clearAllCached membuang cache turunan tapi bukan sync', async () => {
    const fetcher = vi.fn().mockResolvedValue(['X']);
    await withPersistentCache('k', 60_000, fetcher);
    await withPersistentCache('k', 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    syncStore.set('s', 1);
    clearAllCached();
    expect(derivedCache.get('k')).toBeUndefined();
    expect(syncStore.get('s')).toBe(1);
  });
});

const rec = (id: string, date: string, status: string, sid = 's1') => ({
  id, date, subject: 'MTK', details: [{ studentId: sid, status }, { studentId: 'other', status: 'Alpa' }],
});

describe('attendanceSync', () => {
  const today = '2026-11-09';
  const all = [rec('a', '2026-09-01', 'Hadir'), rec('b', '2026-11-01', 'Sakit'), rec('c', '2026-11-08', 'Hadir')];

  it('hasil sinkron penuh identik dengan summarizeAttendance atas seluruh dokumen', () => {
    const st = buildFullState(reduceToStudent(all, 's1'), today);
    expect(summarizeAttendance(Object.values(st.items), 's1')).toEqual(summarizeAttendance(all, 's1'));
  });

  it('sinkron jendela: gabung data baru, ubah yang diedit, buang yang terhapus, jaga yang lama', () => {
    const st = buildFullState(reduceToStudent(all, 's1'), today);
    const later = '2026-11-12';
    const plan = planSync(st, later, shiftWitaDateString);
    expect(plan.kind).toBe('window');
    const windowStart = (plan as { windowStart: string }).windowStart; // 2026-11-02
    expect(windowStart).toBe('2026-11-02');
    // 'b' (11-01) di luar jendela → tetap; 'c' diedit; 'd' baru; tidak ada yang terhapus
    const fetched = reduceToStudent([rec('c', '2026-11-08', 'Izin'), rec('d', '2026-11-11', 'Hadir')], 's1');
    const next = mergeWindow(st, windowStart, fetched, later);
    expect(Object.keys(next.items).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(next.items.c.details[0].status).toBe('Izin');
    // 'c' terhapus (tidak ada di hasil jendela) → hilang
    const next2 = mergeWindow(st, windowStart, [], later);
    expect(Object.keys(next2.items).sort()).toEqual(['a', 'b']);
  });

  it('sinkron penuh ulang setelah 14 hari, dan penuh bila belum ada state', () => {
    expect(planSync(undefined, today, shiftWitaDateString).kind).toBe('full');
    const st = buildFullState([], '2026-10-01');
    expect(planSync(st, today, shiftWitaDateString).kind).toBe('full');
  });
});

import { describeSaveError } from '@/lib/utils/saveError';
describe('describeSaveError', () => {
  it('menerjemahkan penolakan izin ke langkah yang bisa dilakukan guru', () => {
    expect(describeSaveError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })).toMatch(/Muat ulang/);
    expect(describeSaveError(new Error('Missing or insufficient permissions.'))).toMatch(/Muat ulang/);
    expect(describeSaveError({ code: 'unauthenticated' })).toMatch(/Sesi login habis/);
    expect(describeSaveError(new Error('Nama wajib diisi'))).toBe('Nama wajib diisi');
    expect(describeSaveError(null, 'Gagal')).toBe('Gagal');
  });
});
