import { describe, it, expect } from 'vitest';
import { createSupabaseAdapter, toRow, fromRow, buildFilterParams } from '../lib/adapters/supabaseAdapter';
import { isSupabaseCollection } from '../lib/config/dataBackend';

const C = 'session_skip_reasons';

describe('dataBackend flag', () => {
  it('default mati', () => {
    expect(isSupabaseCollection(C, undefined)).toBe(false);
    expect(isSupabaseCollection(C, '')).toBe(false);
  });
  it('hanya koleksi yang tercantum', () => {
    expect(isSupabaseCollection(C, 'a, session_skip_reasons')).toBe(true);
    expect(isSupabaseCollection('grades', 'session_skip_reasons')).toBe(false);
  });
});

describe('mapping', () => {
  it('field di luar kolom masuk metadata, timestamp server dibuang', () => {
    const row = toRow(C, { workspaceId: 'w', scheduleId: 's', note: 'x', date: '2026-10-09', createdAt: {} });
    expect(row).toEqual({ workspace_id: 'w', date: '2026-10-09', metadata: { scheduleId: 's', note: 'x' } });
  });
  it('round trip', () => {
    const out = fromRow(C, { id: '1', workspace_id: 'w', date: 'd', metadata: { scheduleId: 's' }, created_at: 't' });
    expect(out).toMatchObject({ id: '1', workspaceId: 'w', scheduleId: 's', createdAt: 't' });
  });
  it('filter metadata & operator tidak didukung', () => {
    expect(buildFilterParams(C, [['scheduleId', '==', 's']]).toString()).toContain('metadata-%3E%3EscheduleId=eq.s');
    expect(() => buildFilterParams(C, [['date', '>', 'x']])).toThrow();
    expect(() => toRow('grades', {})).toThrow();
  });
});

describe('adapter request', () => {
  const calls: { u: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
  const mk = (token: string | null) =>
    createSupabaseAdapter({
      url: 'https://x.supabase.co/rest/v1/',
      publishableKey: 'pk',
      getToken: async () => token,
      fetchImpl: (async (u: string, init: never) => {
        calls.push({ u, init });
        return { ok: true, status: 200, json: async () => [{ id: '1', workspace_id: 'w', metadata: {} }], text: async () => '' };
      }) as unknown as typeof fetch,
    });
  it('kirim token pengguna, bukan secret; URL dinormalisasi', async () => {
    await mk('tok').getDocuments(C, [['workspaceId', '==', 'w']]);
    expect(calls[0].u).toBe('https://x.supabase.co/rest/v1/session_skip_reasons?workspace_id=eq.w&select=*');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
  });
  it('tanpa login ditolak', async () => {
    await expect(mk(null).getDocuments(C)).rejects.toThrow();
  });
  it('update tidak mengirim workspace_id', async () => {
    calls.length = 0;
    await mk('tok').updateDocument(C, '1', { reason: 'sakit' });
    const patch = calls.find((c) => c.init.method === 'PATCH');
    expect(JSON.parse(String(patch?.init.body)).workspace_id).toBeUndefined();
  });
});
