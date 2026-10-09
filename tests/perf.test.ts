import { describe, expect, it, vi } from 'vitest';
import { measure, startPerf } from '../lib/utils/perf';

describe('perf helper', () => {
  it('measure mengembalikan hasil & melempar ulang error tanpa menelannya (Node: tanpa window)', async () => {
    await expect(measure('x', async () => 42)).resolves.toBe(42);
    await expect(measure('x', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
  it('mencatat ke window.__perf & console saat ada window', async () => {
    const dispatched: string[] = [];
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => dispatched.push(e.type), location: { search: '' } });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const done = startPerf('tahap');
    done();
    const w = (globalThis as unknown as { window: { __perf: { label: string }[] } }).window;
    expect(w.__perf[0].label).toBe('tahap');
    expect(info).toHaveBeenCalled();
    expect(dispatched).toContain('perf-update');
    vi.unstubAllGlobals();
    info.mockRestore();
  });
});
