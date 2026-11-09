import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

// Admin SDK di-mock (bukan Firestore sungguhan). Fokus: transaksi, nominal,
// signature waktu-konstan, anti-regresi status, dan status HTTP webhook.

const fake = createFakeAdminDb();
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__TS__' } }));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db }));

import { POST } from '../app/api/payments/webhook/route';
import { setErrorReporter, setLogSink } from '../lib/utils/logger';
import { handleMidtransNotification, verifySignature, PaymentNotificationError } from '../lib/server/paymentService';

const SERVER_KEY = 'SB-Mid-server-test-key';

function sign(orderId: string, statusCode: string, grossAmount: string, key = SERVER_KEY) {
  return crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${key}`).digest('hex');
}
function notification(over: Record<string, string> = {}) {
  const base = { order_id: 'ws-w1-individual_monthly-1', status_code: '200', gross_amount: '19000.00', transaction_status: 'settlement' };
  const p: Record<string, string> = { ...base, ...over };
  if (!('signature_key' in over)) p.signature_key = sign(p.order_id, p.status_code, p.gross_amount);
  return p;
}
const webhookReq = (body: unknown) =>
  new NextRequest('http://localhost/api/payments/webhook', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const workspaceUpdates = () => fake.writes.filter((w) => w.path === 'workspaces/w1' && w.op === 'update');

beforeEach(() => {
  fake.reset();
  process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
  fake.store['workspaces/w1'] = { plan: 'individual_lifetime', classLimit: 3, ownerUid: 'o' };
  fake.store['payments/ws-w1-individual_monthly-1'] = {
    workspaceId: 'w1', plan: 'individual_monthly', seatCount: null, grossAmount: 19000, status: 'pending',
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('verifySignature', () => {
  it('menerima signature benar dan menolak yang salah / panjang beda / bukan string tanpa melempar', () => {
    const good = notification() as any;
    expect(verifySignature(good, SERVER_KEY)).toBe(true);
    expect(verifySignature({ ...good, signature_key: 'x' }, SERVER_KEY)).toBe(false);
    expect(verifySignature({ ...good, signature_key: good.signature_key.slice(0, -1) + (good.signature_key.endsWith('0') ? '1' : '0') }, SERVER_KEY)).toBe(false);
    expect(verifySignature({ ...good, signature_key: '' }, SERVER_KEY)).toBe(false);
    expect(verifySignature({ ...good, gross_amount: 19000 }, SERVER_KEY)).toBe(false);
    expect(verifySignature({} as any, SERVER_KEY)).toBe(false);
    expect(verifySignature(good, 'kunci-lain')).toBe(false);
  });

  it('memakai crypto.timingSafeEqual (bukan ===)', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    verifySignature(notification() as any, SERVER_KEY);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('handleMidtransNotification', () => {
  it('settlement valid: plan diterapkan ke workspace dan payment ditandai settled', async () => {
    const res = await handleMidtransNotification(notification() as any);
    expect(res).toEqual({ alreadyProcessed: false, applied: true });
    expect(fake.store['workspaces/w1']).toMatchObject({ plan: 'individual_monthly', classLimit: null });
    expect(fake.store['workspaces/w1'].planExpiresAt).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(fake.store['payments/ws-w1-individual_monthly-1']).toMatchObject({ status: 'settled', settledAt: '__TS__' });
  });

  it('school_annual menetapkan seatLimit dari jumlah kursi yang dibeli', async () => {
    fake.store['payments/ws-w1-school_annual-2'] = { workspaceId: 'w1', plan: 'school_annual', seatCount: 5, grossAmount: 1_200_000, status: 'pending' };
    await handleMidtransNotification(notification({ order_id: 'ws-w1-school_annual-2', gross_amount: '1200000.00' }) as any);
    expect(fake.store['workspaces/w1']).toMatchObject({ plan: 'school_annual', seatLimit: 5, classLimit: null });
  });

  it('dua notifikasi settlement BERSAMAAN hanya menerapkan plan satu kali', async () => {
    const [a, b] = await Promise.all([
      handleMidtransNotification(notification() as any),
      handleMidtransNotification(notification() as any),
    ]);
    expect([a.applied, b.applied].sort()).toEqual([false, true]);
    expect([a.alreadyProcessed, b.alreadyProcessed].sort()).toEqual([false, true]);
    expect(workspaceUpdates()).toHaveLength(1);
  });

  it('notifikasi ulang setelah settled diabaikan (idempoten)', async () => {
    await handleMidtransNotification(notification() as any);
    const again = await handleMidtransNotification(notification() as any);
    expect(again).toEqual({ alreadyProcessed: true, applied: false });
    expect(workspaceUpdates()).toHaveLength(1);
  });

  it('signature salah ditolak 401 dan TIDAK menyentuh data apa pun', async () => {
    const before = JSON.stringify(fake.store);
    await expect(handleMidtransNotification(notification({ signature_key: 'a'.repeat(128) }) as any)).rejects.toMatchObject({ status: 401 });
    expect(JSON.stringify(fake.store)).toBe(before);
    expect(fake.writes).toHaveLength(0);
  });

  it('nominal bertanda-tangan tapi TIDAK sama dengan order: ditolak 400, plan tidak dibuka', async () => {
    const forged = notification({ gross_amount: '1000.00' }); // signature dibuat valid untuk 1000.00
    await expect(handleMidtransNotification(forged as any)).rejects.toMatchObject({ status: 400 });
    expect(fake.store['workspaces/w1'].plan).toBe('individual_lifetime');
    expect(fake.store['payments/ws-w1-individual_monthly-1'].status).toBe('pending');
  });

  it('nominal dengan format desimal Midtrans ("19000.00") dianggap sama dengan 19000', async () => {
    await expect(handleMidtransNotification(notification({ gross_amount: '19000.00' }) as any)).resolves.toMatchObject({ applied: true });
  });

  it('order tidak dikenal: 404', async () => {
    await expect(handleMidtransNotification(notification({ order_id: 'ws-x-1' }) as any)).rejects.toMatchObject({ status: 404 });
  });

  it('payload cacat (gross_amount bukan angka): 400', async () => {
    await expect(handleMidtransNotification(notification({ gross_amount: 'abc' }) as any)).rejects.toMatchObject({ status: 400 });
  });

  it.each(['pending', 'expire', 'cancel', 'deny'])('event "%s" yang datang SETELAH settled tidak menurunkan status maupun plan', async (status) => {
    await handleMidtransNotification(notification() as any);
    const res = await handleMidtransNotification(notification({ transaction_status: status, status_code: status === 'pending' ? '201' : '202' }) as any);
    expect(res).toEqual({ alreadyProcessed: true, applied: false });
    expect(fake.store['payments/ws-w1-individual_monthly-1'].status).toBe('settled');
    expect(fake.store['workspaces/w1'].plan).toBe('individual_monthly');
  });

  it('event "pending" telat tidak menimpa status akhir gagal (expire)', async () => {
    await handleMidtransNotification(notification({ transaction_status: 'expire', status_code: '202' }) as any);
    expect(fake.store['payments/ws-w1-individual_monthly-1'].status).toBe('expire');
    await handleMidtransNotification(notification({ transaction_status: 'pending', status_code: '201' }) as any);
    expect(fake.store['payments/ws-w1-individual_monthly-1'].status).toBe('expire');
    expect(fake.store['workspaces/w1'].plan).toBe('individual_lifetime');
  });

  it('pending -> expire dicatat; capture dengan fraud_status challenge TIDAK membuka plan', async () => {
    await handleMidtransNotification(notification({ transaction_status: 'capture', fraud_status: 'challenge' }) as any);
    expect(fake.store['payments/ws-w1-individual_monthly-1'].status).toBe('capture');
    expect(fake.store['workspaces/w1'].plan).toBe('individual_lifetime');
    const ok = await handleMidtransNotification(notification({ transaction_status: 'capture', fraud_status: 'accept' }) as any);
    expect(ok.applied).toBe(true);
  });

  it('gagal di tengah transaksi: tidak ada perubahan setengah jalan (workspace tak ada)', async () => {
    delete fake.store['workspaces/w1'];
    await expect(handleMidtransNotification(notification() as any)).rejects.toBeInstanceOf(PaymentNotificationError);
    expect(fake.store['payments/ws-w1-individual_monthly-1'].status).toBe('pending');
  });
});

describe('POST /api/payments/webhook — status HTTP', () => {
  it('200 hanya untuk notifikasi yang diproses', async () => {
    const res = await POST(webhookReq(notification()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: true });
  });
  it('200 untuk notifikasi duplikat (sudah diproses)', async () => {
    await POST(webhookReq(notification()));
    const res = await POST(webhookReq(notification()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadyProcessed: true });
  });
  it('401 untuk signature tidak valid (BUKAN 200)', async () => {
    const res = await POST(webhookReq(notification({ signature_key: 'x' })));
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
  });
  it('400 untuk nominal tak cocok dan untuk body bukan JSON', async () => {
    expect((await POST(webhookReq(notification({ gross_amount: '1.00' })))).status).toBe(400);
    const bad = new NextRequest('http://localhost/api/payments/webhook', { method: 'POST', body: 'bukan json' });
    expect((await POST(bad)).status).toBe(400);
  });
  it('404 untuk order tidak dikenal', async () => {
    expect((await POST(webhookReq(notification({ order_id: 'nope' })))).status).toBe(404);
  });
  it('500 generik (tanpa membocorkan pesan internal) untuk error tak terduga', async () => {
    delete process.env.MIDTRANS_SERVER_KEY;
    const res = await POST(webhookReq(notification()));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/MIDTRANS_SERVER_KEY/);
  });
});

describe('peringatan ke pemantauan (Sentry)', () => {
  it('signature salah (401) dan nominal tak cocok (400) dilaporkan sebagai error; order tak dikenal (404) tidak', async () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    setLogSink(() => undefined);
    try {
      await POST(webhookReq(notification({ signature_key: 'x' })));
      await POST(webhookReq(notification({ gross_amount: '1.00' })));
      expect(reporter).toHaveBeenCalledTimes(2);
      expect(reporter.mock.calls[0][1]).toMatchObject({ event: 'midtrans_webhook.rejected', status: 401 });
      expect(reporter.mock.calls[1][1]).toMatchObject({ event: 'midtrans_webhook.rejected', status: 400 });
      await POST(webhookReq(notification({ order_id: 'tak-dikenal' })));
      expect(reporter).toHaveBeenCalledTimes(2);
    } finally {
      setErrorReporter(null);
      setLogSink(null);
    }
  });
});
