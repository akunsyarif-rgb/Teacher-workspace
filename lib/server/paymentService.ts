import midtransClient from 'midtrans-client';
import crypto, { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';
import { ApiError } from './apiErrors';
import { PLAN_PRICES, PLAN_CLASS_LIMITS, PLAN_DURATION_MS, isPaidPlan, type PaidPlan } from '../config/plans';

const PAYMENTS_COLLECTION = 'payments';
const MAX_SEATS_PER_ORDER = 500;
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
    throw new ApiError('workspaceId dan uid diperlukan.', 400);
  }
  if (!isPaidPlan(plan)) {
    throw new ApiError('Paket tidak valid.', 400);
  }

  let grossAmount: number;
  let seatCount: number | null = null;

  if (plan === 'school_annual') {
    seatCount = Math.floor(Number(input.seatCount));
    if (!seatCount || seatCount < 1) {
      throw new ApiError('Jumlah kursi guru wajib diisi (minimal 1) untuk paket sekolah.', 400);
    }
    if (seatCount > MAX_SEATS_PER_ORDER) {
      throw new ApiError(`Jumlah kursi guru maksimal ${MAX_SEATS_PER_ORDER} per pesanan. Hubungi admin untuk kebutuhan lebih besar.`, 400);
    }
    grossAmount = PLAN_PRICES.school_annual * seatCount;
  } else {
    grossAmount = PLAN_PRICES[plan];
  }

  // order_id Midtrans maksimal 50 karakter. Format lama `ws-<workspaceId 20 char>-<plan>-<epoch>`
  // = 51-56 karakter (ditolak Midtrans). Id baru pendek dan acak; hubungan ke workspace/paket
  // ada di dokumen payments/{orderId} (webhook mencari lewat dokumen itu, tidak mem-parse id).
  const orderId = `TW-${Date.now().toString(36).toUpperCase()}-${randomBytes(5).toString('hex').toUpperCase()}`;
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
      // Jam server Firestore, bukan jam instance Vercel (anti clock-skew).
      createdAt: FieldValue.serverTimestamp(),
    });

  const snap = getSnapClient();
  // @types/midtrans-client (community) cuma mendeklarasikan
  // transaction_details — customer_details & item_details di bawah ini
  // valid & didukung Midtrans (lihat dokumentasi Snap API resminya),
  // cuma belum dideklarasikan di package types-nya. Cast ke tipe parameter
  // aslinya (lewat unknown) di sini murni menyiasati itu, bukan longgar terhadap tipe data kita
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
  } as unknown as Parameters<typeof snap.createTransaction>[0]);

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

// Error yang dipetakan route webhook ke status HTTP. SEMUA kegagalan validasi
// dibalas non-2xx: Midtrans menganggap non-2xx sebagai gagal kirim (mencoba
// ulang / menandai di dashboard), dan kita ikut punya jejak log untuk
// investigasi percobaan penyalahgunaan — bukan 200 yang menelan masalahnya.
export class PaymentNotificationError extends ApiError {}

// Perbandingan waktu-konstan (timingSafeEqual) agar signature tidak bisa
// ditebak karakter demi karakter lewat selisih waktu respons. Panjang
// harus sama (sha512 hex = 128 karakter) — timingSafeEqual melempar bila beda.
export function verifySignature(payload: MidtransNotificationPayload, serverKey: string) {
  if (
    typeof payload?.order_id !== 'string' ||
    typeof payload.status_code !== 'string' ||
    typeof payload.gross_amount !== 'string' ||
    typeof payload.signature_key !== 'string'
  ) {
    return false;
  }
  const expected = Buffer.from(
    crypto
      .createHash('sha512')
      .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
      .digest('hex'),
    'utf8'
  );
  const received = Buffer.from(payload.signature_key, 'utf8');
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

// Midtrans mengirim gross_amount sebagai string desimal ("149000.00").
function parseGrossAmount(value: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Status akhir yang TIDAK boleh ditimpa event 'pending' yang datang telat.
const FINAL_FAILED_STATUSES = new Set(['expire', 'cancel', 'deny', 'failure']);

// Dipanggil dari route /api/payments/webhook — satu-satunya jalur yang
// boleh mengubah plan/classLimit/seatLimit/planExpiresAt workspace,
// karena field itu dikunci dari client di firestore.rules. Admin SDK di
// sini bypass rules sepenuhnya, jadi verifikasi signature + nominal di bawah
// ini adalah penjaga utamanya.
//
// Pembacaan status pembayaran, penerapan plan ke workspace, dan penandaan
// 'settled' terjadi dalam SATU transaksi Firestore: dua notifikasi bersamaan
// (retry Midtrans) tidak bisa sama-sama menerapkan plan — yang kedua membaca
// status 'settled' dan berhenti.
export async function handleMidtransNotification(payload: MidtransNotificationPayload) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    throw new Error('MIDTRANS_SERVER_KEY belum di-set di environment variable.');
  }
  if (!verifySignature(payload, serverKey)) {
    throw new PaymentNotificationError('Signature Midtrans tidak valid — notifikasi ditolak.', 401);
  }
  const paidAmount = parseGrossAmount(payload.gross_amount);
  if (paidAmount === null || typeof payload.transaction_status !== 'string') {
    throw new PaymentNotificationError('Payload notifikasi tidak lengkap atau salah bentuk.', 400);
  }

  const adminDb = getAdminDb();
  const paymentRef = adminDb.collection(PAYMENTS_COLLECTION).doc(payload.order_id);

  return adminDb.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    if (!paymentSnap.exists) {
      throw new PaymentNotificationError(`Payment record untuk order_id ${payload.order_id} tidak ditemukan.`, 404);
    }
    const payment = paymentSnap.data() as {
      workspaceId: string;
      plan: PaidPlan;
      seatCount: number | null;
      grossAmount: number;
      status: string;
    };

    // Nominal yang dibayar HARUS sama dengan yang kita catat saat membuat
    // transaksi. Signature menjamin payload asli dari Midtrans, tapi bukan
    // bahwa nominalnya sesuai paket yang akan dibuka.
    if (paidAmount !== payment.grossAmount) {
      throw new PaymentNotificationError(
        `Nominal notifikasi (${paidAmount}) tidak sama dengan nominal order (${payment.grossAmount}).`,
        400
      );
    }

    // Idempoten + anti-regresi: begitu 'settled', event apa pun (settlement
    // ulang, pending/expire/cancel yang datang telat) diabaikan.
    if (payment.status === 'settled') {
      return { alreadyProcessed: true, applied: false };
    }

    const isSuccess =
      payload.transaction_status === 'settlement' ||
      (payload.transaction_status === 'capture' && payload.fraud_status === 'accept');

    if (!isSuccess) {
      // 'pending' telat tidak boleh menimpa status akhir gagal (expire/cancel/deny).
      if (payload.transaction_status === 'pending' && FINAL_FAILED_STATUSES.has(payment.status)) {
        return { alreadyProcessed: false, applied: false };
      }
      tx.update(paymentRef, { status: payload.transaction_status, updatedAt: FieldValue.serverTimestamp() });
      return { alreadyProcessed: false, applied: false };
    }

    const workspaceRef = adminDb.collection(WORKSPACES_COLLECTION).doc(payment.workspaceId);
    const workspaceSnap = await tx.get(workspaceRef);
    if (!workspaceSnap.exists) {
      throw new PaymentNotificationError(`Workspace ${payment.workspaceId} untuk order ini tidak ditemukan.`, 404);
    }

    const plan = payment.plan;
    const durationMs = PLAN_DURATION_MS[plan];
    // Dasar waktu masa berlaku = jam SERVER FIRESTORE saat transaksi membaca dokumen
    // (readTime), bukan Date.now() instance Vercel yang bisa melenceng. Berupa epoch ms
    // karena planExpiresAt dibandingkan sebagai angka di rules/UI/getEffectiveClassLimit.
    const serverNowMs = workspaceSnap.readTime?.toMillis?.() ?? Date.now();
    const workspaceUpdate: Record<string, unknown> = {
      plan,
      classLimit: PLAN_CLASS_LIMITS[plan],
      planExpiresAt: durationMs ? serverNowMs + durationMs : null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (plan === 'school_annual') {
      // Menimpa (bukan menambah) seatLimit dengan jumlah kursi yang baru
      // dibeli — cukup untuk versi pertama; beli tambahan kursi berarti
      // owner memasukkan total kursi yang diinginkan, bukan tambahannya.
      workspaceUpdate.seatLimit = payment.seatCount;
    }

    tx.update(workspaceRef, workspaceUpdate);
    tx.update(paymentRef, { status: 'settled', settledAt: FieldValue.serverTimestamp() });
    return { alreadyProcessed: false, applied: true };
  });
}
