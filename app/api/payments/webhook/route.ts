import { NextRequest, NextResponse } from 'next/server';
import { identityOnSupabase } from '@/lib/server/supabaseServer';
import { handleMidtransNotification } from '@/lib/server/paymentService';

export const runtime = 'nodejs';

// URL ini yang didaftarkan sebagai "Payment Notification URL" di
// Midtrans Dashboard (Settings → Configuration). Tidak ada auth header
// dari Midtrans — keasliannya diverifikasi lewat signature_key di dalam
// payload itu sendiri (lihat handleMidtransNotification).
export async function POST(request: NextRequest) {
  // Pembayaran/langganan di luar scope migrasi Supabase: saat identitas workspace berjalan di Supabase, rute ini
  // MENOLAK (bukan menulis ke Firestore yang sudah tidak menjadi sumber kebenaran workspace). Tidak ada akses guru
  // yang bergantung pada rute ini.
  if (identityOnSupabase()) {
    return NextResponse.json({ error: 'Pembayaran belum tersedia pada konfigurasi ini.' }, { status: 501 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Payload tidak valid.' }, { status: 400 });
  }

  try {
    // Bentuk payload divalidasi secara implisit lewat verifySignature di
    // dalam handleMidtransNotification — field yang tidak lengkap/salah
    // bentuk akan gagal di situ, bukan di sini.
    const result = await handleMidtransNotification(payload as Parameters<typeof handleMidtransNotification>[0]);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('midtrans webhook error:', error);
    const isPermanentRejection = /signature|tidak ditemukan/i.test(String(error.message || ''));
    // Signature tidak valid / order_id tak dikenal: retry oleh Midtrans
    // tidak akan pernah berhasil, jadi balas 200 supaya tidak di-retry
    // terus, tapi tetap dicatat di log server untuk investigasi (bisa
    // jadi indikasi percobaan penyalahgunaan). Error lain (mis. Firestore
    // sempat gagal) dibalas 500 supaya Midtrans retry otomatis.
    return NextResponse.json({ ok: false, error: error.message }, { status: isPermanentRejection ? 200 : 500 });
  }
}
