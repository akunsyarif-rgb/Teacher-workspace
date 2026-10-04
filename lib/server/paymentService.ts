import midtransClient from 'midtrans-client';
import crypto from 'node:crypto';
import { adminGetOne, adminUpsert, adminUpdate } from './supabaseAdmin';
import { PLAN_PRICES, PLAN_CLASS_LIMITS, PLAN_DURATION_MS, isPaidPlan, type PaidPlan } from '../config/plans';

function getSnapClient() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
  if (!serverKey || !clientKey) throw new Error('MIDTRANS_SERVER_KEY / NEXT_PUBLIC_MIDTRANS_CLIENT_KEY belum di-set di environment variable.');
  return new midtransClient.Snap({ isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true', serverKey, clientKey });
}

function describePlan(plan: PaidPlan, seatCount?: number) {
  switch (plan) {
    case 'individual_onetime': return 'Teacher Workspace — Individu Sekali Bayar (6 kelas)';
    case 'individual_monthly': return 'Teacher Workspace — Individu Bulanan (kelas tak terbatas)';
    case 'school_annual': return `Teacher Workspace — Sekolah Tahunan (${seatCount} kursi guru)`;
  }
}

type CreateTransactionInput = { workspaceId:string; uid:string; plan:PaidPlan; seatCount?:number; customerEmail?:string; customerName?:string };

export async function createPaymentTransaction(input: CreateTransactionInput) {
  const { workspaceId, uid, plan, customerEmail, customerName } = input;
  if (!workspaceId || !uid) throw new Error('workspaceId dan uid diperlukan.');
  if (!isPaidPlan(plan)) throw new Error('Paket tidak valid.');
  let grossAmount:number; let seatCount:number|null=null;
  if (plan === 'school_annual') {
    seatCount = Math.floor(Number(input.seatCount));
    if (!seatCount || seatCount < 1) throw new Error('Jumlah kursi guru wajib diisi (minimal 1) untuk paket sekolah.');
    grossAmount = PLAN_PRICES.school_annual * seatCount;
  } else grossAmount = PLAN_PRICES[plan];

  const orderId = `ws-${workspaceId}-${plan}-${Date.now()}`;
  await adminUpsert('payments', { orderId, workspaceId, uid, plan, seatCount, grossAmount, amount:grossAmount, currency:'IDR', status:'pending', createdAt:new Date().toISOString() });

  const transaction = await getSnapClient().createTransaction({
    transaction_details:{ order_id:orderId, gross_amount:grossAmount },
    customer_details:{ email:customerEmail, first_name:customerName || 'Guru' },
    item_details:[{ id:plan, price:grossAmount, quantity:1, name:describePlan(plan,seatCount ?? undefined) }],
  } as any);
  return { token:transaction.token as string, redirectUrl:transaction.redirect_url as string, orderId };
}

type MidtransNotificationPayload = { order_id:string; status_code:string; gross_amount:string; signature_key:string; transaction_status:string; fraud_status?:string };
function verifySignature(payload:MidtransNotificationPayload, serverKey:string) {
  const expected = crypto.createHash('sha512').update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`).digest('hex');
  return expected === payload.signature_key;
}

export async function handleMidtransNotification(payload:MidtransNotificationPayload) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY belum di-set di environment variable.');
  if (!verifySignature(payload,serverKey)) throw new Error('Signature Midtrans tidak valid — notifikasi ditolak.');
  const payment = await adminGetOne<any>('payments','orderId',payload.order_id);
  if (!payment) throw new Error(`Payment record untuk order_id ${payload.order_id} tidak ditemukan.`);
  if (payment.status === 'settled') return { alreadyProcessed:true, applied:false };

  const isSuccess = payload.transaction_status === 'settlement' || (payload.transaction_status === 'capture' && payload.fraud_status === 'accept');
  if (!isSuccess) {
    await adminUpdate('payments',[['orderId','==',payload.order_id]],{status:payload.transaction_status,updatedAt:new Date().toISOString()});
    return { alreadyProcessed:false, applied:false };
  }

  const plan = payment.plan as PaidPlan;
  const durationMs = PLAN_DURATION_MS[plan];
  const workspaceUpdate:any = { plan, classLimit:PLAN_CLASS_LIMITS[plan], planExpiresAt:durationMs ? Date.now()+durationMs : null, updatedAt:new Date().toISOString() };
  if (plan === 'school_annual') workspaceUpdate.seatLimit = payment.seatCount;
  await adminUpdate('workspaces',[['id','==',payment.workspaceId]],workspaceUpdate);
  await adminUpdate('payments',[['orderId','==',payload.order_id]],{status:'settled',settledAt:Date.now(),updatedAt:new Date().toISOString()});
  return { alreadyProcessed:false, applied:true };
}
