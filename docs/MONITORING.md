# Pemantauan kesalahan (Sentry)

Status: **kode siap, belum aktif** — menunggu `NEXT_PUBLIC_SENTRY_DSN` dari pemilik project.

## Mengaktifkan
1. Buat project Sentry (platform: Next.js), salin DSN.
2. Di Vercel › Environment Variables isi `NEXT_PUBLIC_SENTRY_DSN` (Production dan Preview), opsional `NEXT_PUBLIC_SENTRY_ENVIRONMENT`.
3. Deploy ulang (variabel `NEXT_PUBLIC_*` dibenamkan saat build). Log server mencatat `monitoring.enabled`.

## Yang terpasang
- **Server**: `instrumentation.ts` menyalakan pelapor (`lib/server/monitoring.ts`) dan `onRequestError` menangkap galat tak tertangani.
  Semua `logger.error(..., { err })` di route/webhook otomatis dikirim (`lib/utils/logger.ts` › `setErrorReporter`).
- **Browser**: error boundary (`app/error.tsx`, `app/student/error.tsx`, `app/global-error.tsx`) dan penangkap `error`/`unhandledrejection` global.
- **Webhook Midtrans**: signature salah (401) dan nominal tak cocok/payload cacat (400) dikirim sebagai error (tag `event:midtrans_webhook.rejected`).
- **CSP**: origin ingest Sentry ditambahkan otomatis ke `connect-src` bila DSN diisi.

## Privasi
Hanya data yang sudah disaring logger yang dikirim (token, kata sandi, JWT, kunci, dan pola rahasia disamarkan; string dipotong). Tidak ada PII yang sengaja dikirim. Tanpa DSN semuanya no-op.
Batas kirim 30 event/menit/proses dan dedupe galat identik 30 detik.

## Rekomendasi alert di Sentry
- Alert rule: tag `event` = `midtrans_webhook.rejected` → notifikasi segera (indikasi penyalahgunaan/salah konfigurasi pembayaran).
- Alert rule: event baru dengan tag `runtime:node` dan `event` diawali `request.unhandled`.
- Lonjakan `client.error` setelah rilis.

## Batasan dan langkah lanjut
- Dikirim lewat protokol envelope langsung (tanpa SDK): stack trace berupa teks, belum ter-symbolicate, tanpa breadcrumb/tracing,
  dan belum diuji terhadap endpoint Sentry sungguhan. Untuk source map dan performa, ganti dengan `@sentry/nextjs`
  (titik sambung `setErrorReporter` tetap sama).
