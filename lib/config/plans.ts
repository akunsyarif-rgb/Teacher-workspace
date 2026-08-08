// Konfigurasi paket & harga — sengaja dipisah tanpa dependensi Firestore
// apa pun (client maupun admin SDK), supaya bisa diimpor dengan aman baik
// dari kode client (lib/services/workspaceService.ts) maupun kode
// server-only (lib/server/paymentService.ts) tanpa risiko menarik
// inisialisasi Firebase client SDK ke dalam konteks server.

export type WorkspacePlan =
  | 'individual_lifetime' // gratis, 3 kelas
  | 'individual_onetime' // sekali bayar, 6 kelas, tidak kedaluwarsa
  | 'individual_monthly' // langganan bulanan, kelas tak terbatas
  | 'school_annual'; // langganan tahunan per kursi guru, kelas tak terbatas

export type PaidPlan = 'individual_onetime' | 'individual_monthly' | 'school_annual';

// Batas gratis default — dipakai tier individual_lifetime DAN sebagai
// titik awal workspace sekolah sebelum owner-nya benar-benar membayar.
// 3 kelas sengaja dibuat pas-pasan (bukan besar) supaya guru dengan
// beban mengajar normal tetap punya alasan upgrade ke paket berbayar.
export const FREE_CLASS_LIMIT = 3;
export const FREE_SEAT_LIMIT = 1; // cuma pemilik, sampai beli kursi guru tambahan

// Batas kelas per paket. null = tak terbatas.
export const PLAN_CLASS_LIMITS: Record<WorkspacePlan, number | null> = {
  individual_lifetime: FREE_CLASS_LIMIT,
  individual_onetime: 6,
  individual_monthly: null,
  school_annual: null,
};

// Harga dalam Rupiah — SATU-SATUNYA sumber kebenaran harga, dipakai di
// sisi server (route pembuatan transaksi pembayaran) untuk menghitung
// gross_amount Midtrans. Tidak pernah dipercaya dari input client, supaya
// tidak bisa dimanipulasi lewat DevTools. school_annual dihitung per
// kursi guru (seatCount x harga ini), ditagih sekali di muka untuk satu
// tahun.
export const PLAN_PRICES: Record<PaidPlan, number> = {
  individual_onetime: 149_000,
  individual_monthly: 19_000,
  school_annual: 240_000,
};

// Lama berlaku paket sejak pembayaran sukses. Paket yang tidak ada di
// sini (gratis & sekali-bayar) tidak pernah kedaluwarsa.
export const PLAN_DURATION_MS: Partial<Record<WorkspacePlan, number>> = {
  individual_monthly: 30 * 24 * 60 * 60 * 1000,
  school_annual: 365 * 24 * 60 * 60 * 1000,
};

export function isPaidPlan(plan: string): plan is PaidPlan {
  return plan === 'individual_onetime' || plan === 'individual_monthly' || plan === 'school_annual';
}
