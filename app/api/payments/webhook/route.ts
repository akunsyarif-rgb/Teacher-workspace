import { NextRequest, NextResponse } from 'next/server';
import { handleMidtransNotification, PaymentNotificationError } from '@/lib/server/paymentService';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';

// URL ini yang didaftarkan sebagai "Payment Notification URL" di
// Midtrans Dashboard (Settings → Configuration). Tidak ada auth header
// dari Midtrans — keasliannya diverifikasi lewat signature_key di dalam
// payload itu sendiri (lihat handleMidtransNotification).
//
// Status HTTP: 200 HANYA bila notifikasi benar-benar diproses (atau sudah
// pernah diproses — idempoten). Signature salah (401), nominal tak cocok /
// payload cacat (400), order tak dikenal (404), dan kegagalan sementara
// (500) semuanya non-2xx supaya Midtrans tahu notifikasinya tidak diterima
// dan kita punya jejak untuk dicek — bukan ditelan dengan 200.
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload tidak valid.' }, { status: 400 });
  }

  try {
    const result = await handleMidtransNotification(payload as Parameters<typeof handleMidtransNotification>[0]);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PaymentNotificationError) {
      // Dicatat sebagai peringatan: bisa jadi indikasi percobaan penyalahgunaan atau salah konfigurasi.
      // Signature salah (401) / nominal tak cocok atau payload cacat (400) = indikasi penyalahgunaan atau salah konfigurasi:
      // naik ke level error DENGAN err supaya sampai ke pemantauan (Sentry). 404 (order tak dikenal, mis. tes Midtrans) cukup warn.
      if (error.status === 404) logger.warn('midtrans_webhook.rejected', { status: error.status, reason: error.message });
      else logger.error('midtrans_webhook.rejected', { status: error.status, err: error });
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    logger.error('midtrans_webhook.failed', { err: error });
    return NextResponse.json({ ok: false, error: 'Gagal memproses notifikasi.' }, { status: 500 });
  }
}
