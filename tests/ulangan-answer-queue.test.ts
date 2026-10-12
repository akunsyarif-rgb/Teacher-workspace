import { describe, expect, it } from 'vitest';
import { createAnswerQueue } from '../lib/services/ulanganAnswerQueue';
import { UlanganApiError } from '../lib/repositories/ulanganRepository';

// Antrean autosave ulangan dengan "server" palsu yang bisa ditahan/digagalkan per request. Yang diuji: jawaban yang dianggap
// tersimpan = yang benar-benar diterima server, dan flush() (dipakai sebelum kumpul) tidak selesai lebih dulu dari request yang berjalan.
function fakeServer() {
  const stored = new Map<string, string>(); // isi "database"
  const calls: { qid: string; oid: string; release: () => void; fail: (e: unknown) => void }[] = [];
  let mode: 'manual' | 'auto' | 'down' | 'closed' = 'auto';
  const save = (qid: string, oid: string) => {
    if (mode === 'down') return Promise.reject(new UlanganApiError('network', 0));
    if (mode === 'closed') return Promise.reject(new UlanganApiError('attempt_expired', 409));
    if (mode === 'auto') { stored.set(qid, oid); return Promise.resolve(true); }
    return new Promise<void>((resolve, reject) => {
      calls.push({ qid, oid, release: () => { stored.set(qid, oid); resolve(); }, fail: reject });
    });
  };
  return { stored, calls, save, setMode: (m: typeof mode) => { mode = m; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('antrean jawaban ulangan', () => {
  it('flush kedua MENUNGGU request yang sedang berjalan (kumpul tidak mendahului autosave)', async () => {
    const srv = fakeServer();
    srv.setMode('manual');
    const q = createAnswerQueue(srv.save);
    q.set('q1', 'B');
    const autosave = q.flush(); // dipicu saat siswa memilih jawaban
    await tick();
    let submitMayProceed = false;
    const beforeSubmit = q.flush().then((r) => { submitMayProceed = r.ok; });
    await tick();
    expect(submitMayProceed).toBe(false); // request masih di jalan → belum boleh kumpul
    expect(srv.stored.size).toBe(0);
    srv.calls[0].release();
    await Promise.all([autosave, beforeSubmit]);
    expect(submitMayProceed).toBe(true);
    expect(srv.stored.get('q1')).toBe('B');
    expect(q.size()).toBe(0);
  });

  it('jawaban diganti saat request lama berjalan: nilai terbaru tetap terkirim, respons lama tidak menghapusnya', async () => {
    const srv = fakeServer();
    srv.setMode('manual');
    const q = createAnswerQueue(srv.save);
    q.set('q1', 'A');
    const first = q.flush();
    await tick();
    q.set('q1', 'C'); // siswa mengganti pilihan sebelum request "A" selesai
    const beforeSubmit = q.flush();
    srv.calls[0].release(); // respons untuk "A" datang
    await tick();
    expect(q.ids()).toEqual(['q1']); // "C" belum dikonfirmasi → masih di antrean
    expect(srv.calls[1]).toMatchObject({ qid: 'q1', oid: 'C' });
    srv.calls[1].release();
    expect(await beforeSubmit).toEqual({ ok: true });
    await first;
    expect(srv.stored.get('q1')).toBe('C');
    expect(q.size()).toBe(0);
  });

  it('gagal jaringan: antrean dipertahankan, hasil ok=false (kumpul harus ditahan), lalu pulih lewat percobaan ulang', async () => {
    const srv = fakeServer();
    const q = createAnswerQueue(srv.save);
    srv.setMode('down');
    q.set('q1', 'B');
    q.set('q2', 'D');
    const r = await q.flush();
    expect(r).toMatchObject({ ok: false, closed: false });
    expect(q.failed()).toBe(true);
    expect(q.ids().sort()).toEqual(['q1', 'q2']);
    expect(srv.stored.size).toBe(0);
    srv.setMode('auto'); // jaringan kembali
    expect(await q.flush()).toEqual({ ok: true });
    expect(q.failed()).toBe(false);
    expect(Object.fromEntries(srv.stored)).toEqual({ q1: 'B', q2: 'D' });
  });

  it('pengerjaan ditutup server: hasil closed=true dan jawaban tidak diklaim tersimpan', async () => {
    const srv = fakeServer();
    const q = createAnswerQueue(srv.save);
    srv.setMode('closed');
    q.set('q1', 'B');
    expect(await q.flush()).toMatchObject({ ok: false, closed: true });
    expect(q.size()).toBe(1);
    expect(q.failed()).toBe(false); // bukan "dicoba lagi": pengerjaan memang sudah selesai
  });

  it('antrean kosong → flush langsung ok tanpa request', async () => {
    let n = 0;
    const q = createAnswerQueue(async () => { n++; });
    expect(await q.flush()).toEqual({ ok: true });
    expect(n).toBe(0);
  });
});
