import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { createFakeAdminDb } from './helpers/fakeAdminDb';

// Waktu dari jam SERVER FIRESTORE (serverTimestamp / readTime), bukan Date.now() instance
// atau perangkat: pembayaran, webhook, dan kedaluwarsa kode undangan.
const fake = createFakeAdminDb();
const createTransaction = vi.fn(async (_body?: unknown) => ({ token: 'snap-token', redirect_url: 'https://pay.example/x' }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => '__SERVER_TS__', delete: () => '__DEL__' } }));
vi.mock('@/lib/server/firebaseAdmin', () => ({ getAdminDb: () => fake.db, getAdminAuth: () => ({}) }));
vi.mock('midtrans-client', () => ({ default: { Snap: class { createTransaction = createTransaction; } } }));

import { createPaymentTransaction, handleMidtransNotification } from '../lib/server/paymentService';
import { joinWorkspaceByCodeServer } from '../lib/server/workspaceAdminService';
import { INVITE_CODE_VALID_MS } from '../lib/config/plans';

const KEY = 'SB-key';
const sign = (o: string, sc: string, g: string) => crypto.createHash('sha512').update(`${o}${sc}${g}${KEY}`).digest('hex');

beforeEach(() => {
  fake.reset();
  process.env.MIDTRANS_SERVER_KEY = KEY;
  process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY = 'ck';
  createTransaction.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createPaymentTransaction', () => {
  const input = { workspaceId: 'a'.repeat(20), uid: 'u1', plan: 'individual_onetime' as const };

  it('createdAt = serverTimestamp (bukan angka dari jam instance)', async () => {
    const { orderId } = await createPaymentTransaction(input);
    expect(fake.store[`payments/${orderId}`]).toMatchObject({ createdAt: '__SERVER_TS__', status: 'pending', workspaceId: input.workspaceId });
    expect(typeof fake.store[`payments/${orderId}`].createdAt).not.toBe('number');
  });

  it('order_id <= 50 karakter (batas Midtrans) untuk SEMUA paket dengan id workspace Firestore 20 karakter, dan unik', async () => {
    const ids = new Set<string>();
    for (const plan of ['individual_onetime', 'individual_monthly', 'school_annual'] as const) {
      for (let i = 0; i < 50; i++) {
        const { orderId } = await createPaymentTransaction({ ...input, plan, seatCount: 2 });
        expect(orderId.length).toBeLessThanOrEqual(50);
        expect(orderId).toMatch(/^TW-[0-9A-Z]+-[0-9A-F]{10}$/);
        ids.add(orderId);
      }
    }
    expect(ids.size).toBe(150);
    expect(createTransaction.mock.calls[0][0]).toMatchObject({ transaction_details: { order_id: expect.stringMatching(/^TW-/) } });
  });

  it('webhook menemukan order lewat dokumen payments, tanpa mem-parse order_id', async () => {
    fake.store['workspaces/' + input.workspaceId] = { plan: 'individual_lifetime', classLimit: 3 };
    const { orderId } = await createPaymentTransaction(input);
    const amount = String(fake.store[`payments/${orderId}`].grossAmount) + '.00';
    const res = await handleMidtransNotification({
      order_id: orderId, status_code: '200', gross_amount: amount, transaction_status: 'settlement',
      signature_key: sign(orderId, '200', amount),
    });
    expect(res.applied).toBe(true);
    expect(fake.store['workspaces/' + input.workspaceId].plan).toBe('individual_onetime');
  });
});

describe('webhook: waktu dari jam server Firestore', () => {
  it('planExpiresAt = readTime server + durasi (bukan Date.now() instance); updatedAt/settledAt = serverTimestamp', async () => {
    const SERVER_NOW = 1_900_000_000_000; // jam server; sengaja jauh dari Date.now()
    fake.hooks.serverNowMs = SERVER_NOW;
    fake.store['workspaces/w1'] = { plan: 'individual_lifetime', classLimit: 3 };
    fake.store['payments/TW-1'] = { workspaceId: 'w1', plan: 'individual_monthly', seatCount: null, grossAmount: 19000, status: 'pending' };
    await handleMidtransNotification({
      order_id: 'TW-1', status_code: '200', gross_amount: '19000.00', transaction_status: 'settlement',
      signature_key: sign('TW-1', '200', '19000.00'),
    });
    expect(fake.store['workspaces/w1'].planExpiresAt).toBe(SERVER_NOW + 30 * 24 * 60 * 60 * 1000);
    expect(fake.store['workspaces/w1'].updatedAt).toBe('__SERVER_TS__');
    expect(fake.store['payments/TW-1']).toMatchObject({ status: 'settled', settledAt: '__SERVER_TS__' });
  });
});

describe('kode undangan: kedaluwarsa dinilai dengan jam server', () => {
  const issuedAt = (ms: number) => ({ toMillis: () => ms });
  const seed = (extra: Record<string, unknown>) => {
    fake.store['workspaces/w1'] = { name: 'S', plan: 'school_annual', ownerUid: 'o', seatLimit: null, inviteCode: 'ABC234', ...extra };
    fake.store['workspace_invites/ABC234'] = { workspaceId: 'w1' };
  };

  it('jam PERANGKAT pembuat kode salah jauh (inviteCodeExpiresAt di masa depan): tetap kedaluwarsa menurut jam server', async () => {
    const SERVER_NOW = 2_000_000_000_000;
    fake.hooks.serverNowMs = SERVER_NOW;
    seed({ inviteCodeIssuedAt: issuedAt(SERVER_NOW - INVITE_CODE_VALID_MS - 1000), inviteCodeExpiresAt: SERVER_NOW + 10 * INVITE_CODE_VALID_MS });
    await expect(joinWorkspaceByCodeServer('t1', 'ABC234')).rejects.toMatchObject({ status: 410 });
  });

  it('jam perangkat pembuat salah ke belakang (expiresAt sudah lewat): kode yang baru dibuat menurut server tetap berlaku', async () => {
    const SERVER_NOW = 2_000_000_000_000;
    fake.hooks.serverNowMs = SERVER_NOW;
    seed({ inviteCodeIssuedAt: issuedAt(SERVER_NOW - 1000), inviteCodeExpiresAt: 1 });
    await expect(joinWorkspaceByCodeServer('t1', 'ABC234')).resolves.toMatchObject({ id: 'w1' });
  });

  it('kode lama tanpa inviteCodeIssuedAt memakai inviteCodeExpiresAt vs jam server', async () => {
    fake.hooks.serverNowMs = 5000;
    seed({ inviteCodeExpiresAt: 4000 });
    await expect(joinWorkspaceByCodeServer('t1', 'ABC234')).rejects.toMatchObject({ status: 410 });
    seed({ inviteCodeExpiresAt: 6000 });
    await expect(joinWorkspaceByCodeServer('t1', 'ABC234')).resolves.toBeTruthy();
  });
});
