import midtransClient from 'midtrans-client';
import crypto from 'node:crypto';
import { getAdminDb } from './firebaseAdmin';
import { PLAN_PRICES, PLAN_CLASS_LIMITS, PLAN_DURATION_MS, isPaidPlan, type PaidPlan } from '../config/plans';

const PAYMENTS_COLLECTION = 'payments';
const WORKSPACES_COLLECTION = 'workspaces';

function getSnapClient() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
  if (!serverKey || !clientKey) {
    throw new Error('MIDTRANS_SERVER_KEY / NEXT_PUBLIC_MIDTRANS_CLIENT_KEY belum di-set di environment variable.');
  }
  return new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey,
    clientKey,
  });
}

function describePlan(plan: PaidPlan, seatCount?: number) {
  switch (plan) {
    case 'individual_onetime':
      return 'Teacher Workspace — Individu Sekali Bayar (6 kelas)';
    case 'individual_monthly':
      return 'Teacher Workspace — Individu Bulanan (kelas tak terbatas)';
    case 'school_annual':
      return `Teacher Workspace — Sekolah Tahunan (${seatCount} kursi guru)`;
  }
}

type CreateTransactionInput = {
  workspaceId: string;
  uid: string;
  plan: PaidPlan;
  seatCount?: number; // wajib & dipakai untuk school_annual saja
  customerEmail?: string;
  customerName?: string;
};

// Dipanggil dari route /api/payments/create-transaction. Harga DIHITUNG DI
// SINI dari PLAN_PRICES (bukan dikirim dari client) — request cuma boleh
// bilang "paket apa" (dan jumlah kursi untuk sekolah), bukan "berapa
// harganya". Ini yang mencegah harga dimanipulasi lewat DevTools.
export async function createPaymentTransaction(input: CreateTransactionInput) {
  const { workspaceId, uid, plan, customerEmail, customerName } = input;
  if (!workspaceId || !uid) {
    throw new Error('workspaceId dan uid diperlukan.');
  }
  if (!isPaidPlan(plan)) {
    throw new Error('Paket tidak valid.');
  }

  let grossAmount: number;
  let seatCount: number | null = null;

  if (plan === 'school_annual') {
    seatCount = Math.floor(Number(input.seatCount));
    if (!seatCount || seatCount < 1) {
      throw new Error('Jumlah kursi guru wajib diisi (minimal 1) untuk paket sekolah.');
    }
    grossAmount = PLAN_PRICES.school_annual * seatCount;
  } else {
    grossAmount = PLAN_PRICES[plan];
  }

  const orderId = `ws-${workspaceId}-${plan}-${Date.now()}`;
  const adminDb = getAdminDb();

  // Catat transaksi PENDING dulu — jadi sumber kebenaran untuk idempotensi
  // webhook (jangan terapkan order_id yang sama dua kali) dan audit trail
  // pembayaran per workspace.
  await adminDb
    .collection(PAYMENTS_COLLECTION)
    .doc(orderId)
    .set({
      orderId,
      workspaceId,
      uid,
      plan,
      seatCount,
      grossAmount,
      status: 'pending',
      createdAt: Date.now(),
    });

  const snap = getSnapClient();
  // @types/midtrans-client (community) cuma mendeklarasikan
  // transaction_details — customer_details & item_details di bawah ini
  // valid & didukung Midtrans (lihat dokumentasi Snap API resminya),
  // cuma belum dideklarasikan di package types-nya. Cast ke `any` di
  // sini murni menyiasati itu, bukan longgar terhadap tipe data kita
  // sendiri (semua field di atas tetap dihitung/divalidasi dengan tipe
  // yang ketat sebelum sampai sini).
  const transaction = await snap.createTransaction({
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    customer_details: {
      email: customerEmail,
      first_name: customerName || 'Guru',
    },
    item_details: [
      {
        id: plan,
        price: grossAmount,
        quantity: 1,
        name: describePlan(plan, seatCount ?? undefined),
      },
    ],
  } as any);

  return { token: transaction.token as string, redirectUrl: transaction.redirect_url as string, orderId };
}

type MidtransNotificationPayload = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  transaction_status: string;
  fraud_status?: string;
};

function verifySignature(payload: MidtransNotificationPayload, serverKey: string) {
  const expected = crypto
    .createHash('sha512')
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
    .digest('hex');
  return expected === payload.signature_key;
}

// Dipanggil dari route /api/payments/webhook — satu-satunya jalur yang
// boleh mengubah plan/classLimit/seatLimit/planExpiresAt workspace,
// karena field itu dikunci dari client di firestore.rules. Admin SDK di
// sini bypass rules sepenuhnya, jadi verifikasi signature di bawah ini
// adalah satu-satunya penjaga — tanpa itu siapa pun bisa memanggil
// endpoint webhook dan meng-upgrade workspace mana pun secara gratis.
export async function handleMidtransNotification(payload: MidtransNotificationPayload) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    throw new Error('MIDTRANS_SERVER_KEY belum di-set di environment variable.');
  }
  if (!verifySignature(payload, serverKey)) {
    throw new Error('Signature Midtrans tidak valid — notifikasi ditolak.');
  }

  const adminDb = getAdminDb();
  const paymentRef = adminDb.collection(PAYMENTS_COLLECTION).doc(payload.order_id);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    throw new Error(`Payment record untuk order_id ${payload.order_id} tidak ditemukan.`);
  }
  const payment = paymentSnap.data() as {
    workspaceId: string;
    plan: PaidPlan;
    seatCount: number | null;
    status: string;
  };

  // Idempoten — Midtrans bisa mengirim notifikasi yang sama lebih dari
  // sekali (mis. retry jaringan); jangan terapkan dua kali.
  if (payment.status === 'settled') {
    return { alreadyProcessed: true, applied: false };
  }

  const isSuccess =
    payload.transaction_status === 'settlement' ||
    (payload.transaction_status === 'capture' && payload.fraud_status === 'accept');

  if (!isSuccess) {
    await paymentRef.update({ status: payload.transaction_status, updatedAt: Date.now() });
    return { alreadyProcessed: false, applied: false };
  }

  const plan = payment.plan;
  const durationMs = PLAN_DURATION_MS[plan];
  const workspaceUpdate: Record<string, unknown> = {
    plan,
    classLimit: PLAN_CLASS_LIMITS[plan],
    planExpiresAt: durationMs ? Date.now() + durationMs : null,
    updatedAt: Date.now(),
  };
  if (plan === 'school_annual') {
    // Menimpa (bukan menambah) seatLimit dengan jumlah kursi yang baru
    // dibeli — cukup untuk versi pertama; beli tambahan kursi berarti
    // owner memasukkan total kursi yang diinginkan, bukan tambahannya.
    workspaceUpdate.seatLimit = payment.seatCount;
  }

  await adminDb.collection(WORKSPACES_COLLECTION).doc(payment.workspaceId).update(workspaceUpdate);
  await paymentRef.update({ status: 'settled', settledAt: Date.now() });

  return { alreadyProcessed: false, applied: true };
}
