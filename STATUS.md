# STATUS — Teacher Workspace + Student Companion (Teacher-workspace)

_Disusun 25 Oktober 2026 dari isi repo (commit terakhir 15 Okt 2026, PR #80). Hanya fakta yang tertulis di repo; yang tidak bisa diverifikasi dari repo ditandai._

## Ringkasan
Dua aplikasi dalam satu proyek Next.js: **Teacher Workspace** (`/`, pusat operasional guru) dan **Student Companion** (`/student`, pendamping siswa; bukan LMS). Versi 0.1.0. Repo public.

## Stack
Next.js, Firebase Auth + Firestore (sistem utama), Supabase (lampiran tugas di Storage privat, dan modul Ulangan Harian), Midtrans Snap (pembayaran paket), Firebase Admin SDK di server. Arsitektur berlapis: UI → Controller → Service → Repository → Adapter → Firestore; semua koleksi di-scope per `workspaceId` (aturan lengkap di `AGENTS.md`).

## Sudah ada
- Guru: jurnal mengajar, presensi, nilai (matriks daftar nilai, nama kolom bisa diedit), tugas, pengumuman, analitik, menu wali kelas, rename kelas.
- Siswa: jadwal, tugas dan pengumpulan (lampiran di Supabase Storage privat, signed URL 5 menit), nilai, kehadiran, pengumuman, profil dan portofolio. Login siswa memakai kode akses dari guru.
- Viewer lampiran: geser antar-file, zoom, tombol PDF layar penuh; siswa bisa melihat lampiran terkirim (#79, #80).
- Digital Notebook terpadu dan akses NotebookLM siswa (13 Okt).
- Backup dan ekspor: Firestore di-backup harian otomatis; menu Backup & Ekspor Data di aplikasi (ZIP, manifest, enkripsi sisi klien, restore teruji); ringkasan PDF presensi dan nilai (#65, #66).
- Panel Pemilik Aplikasi (`/owner`) untuk plan, kuota guru, batas kelas; menu Admin untuk OWNER (daftar guru, kode undangan) (#53, #54).
- Paket berbayar lewat Midtrans (`docs/PAYMENTS.md`). Field plan di workspace dikunci dari client.
- Pengerasan keamanan 9 Okt: celah paywall, profil siswa palsu, dan klaim TEACHER mandiri ditutup (#58).
- Web manifest dan ikon PNG agar bisa dipasang ke layar utama iOS/Safari (#75–#78).
- Pengujian: sekitar 49 berkas di `tests/` (aturan Firestore dan Storage di emulator, logika murni, e2e Playwright). Workflow GitHub: backup Firestore, deploy rules, test rules, tes DB Ulangan.

## Belum / terbuka
- **Ulangan Harian** (Supabase): `docs/ULANGAN-HARIAN.md` menyebut kodenya selesai tapi belum diterapkan ke Supabase dan belum aktif di produksi, dengan branch `feat/ulangan-harian-supabase`. Commit #61 (11 Okt) menyebut modul ini sudah masuk dengan default MATI. Dokumen itu kemungkinan lebih tua dari merge; **cek dulu kondisi sebenarnya**.
- **Migrasi Firestore → Supabase**: `docs/MIGRASI-SUPABASE.md` berstatus Fase 0, usulan, belum disetujui, tanpa perubahan kode atau data.
- Utang teknis sengaja ditunda (`docs/TECHNICAL_DEBT.md`): soft delete (TD-001, dipicu saat ada pengguna eksternal pertama); rename kelas bisa menulis sebagian bila batch Firestore gagal di tengah (ada perlindungan minimal dan skrip cek konsistensi).
- Langkah setup yang butuh akses pemilik project: `docs/PANDUAN-LANGKAH-ANDA.md` dan `docs/AKTIFKAN-STORAGE.md`.
- Jumlah pengguna dan status produksi (Vercel, paket Blaze, Midtrans live atau sandbox) tidak tercatat di repo.

## Hal yang perlu diwaspadai
- Query siswa wajib memakai filter yang menjamin cakupannya, kalau tidak aturan `list` Firestore membuat halaman kosong.
- Rules ter-deploy otomatis dari `main` lewat GitHub Actions. Jangan menempel rules manual lewat Console.
- Prestasi siswa di koleksi sendiri; `student_notes` memuat catatan konseling dan tidak pernah dibuka untuk siswa.
- Perubahan yang merusak fitur lama atau migrasi data wajib disetujui eksplisit (`AGENTS.md`).
- Aplikasi Presensi memakai "kode akun siswa" dari Teacher Workspace sebagai identitas siswa.

## Dokumen penting
`README.md`, `AGENTS.md`, `docs/BACKUP.md`, `docs/TECHNICAL_DEBT.md`, `docs/MIGRASI-SUPABASE.md`, `docs/ULANGAN-HARIAN.md`, `docs/PAYMENTS.md`, `docs/DIGITAL_NOTEBOOK_DESIGN_SPEC.md`.

## Langkah berikutnya (usulan, bukan dari repo)
Pastikan status Ulangan Harian yang sebenarnya (sudah diterapkan di Supabase atau belum), lalu perbarui `docs/ULANGAN-HARIAN.md` agar cocok.

---
Perbarui file ini di akhir tiap sesi kerja: tanggal, apa yang selesai, apa yang terbuka.


## Pembaruan 8 Nov 2026 — siklus audit kesiapan produksi
Selesai (branch `claude/sleepy-brown-6tsnvn`, belum di-merge):
- **Keamanan:** field tenant immutable di rules; batas kelas + kedaluwarsa paket ditegakkan server (`/api/students/create`); webhook Midtrans transaksional, cek nominal, signature waktu-konstan, status non-2xx; kode akses/undangan dibuat CSPRNG dan diverifikasi server dengan rate limit; `requireAuth` terpusat (cek pencabutan sesi); error API disanitasi; kuota kursi join atomik; unggah lampiran divalidasi ketat + rate limit; header keamanan (CSP, HSTS, dst).
- **Keandalan:** soft delete (siswa, tugas, kolom nilai, kelas) + pemulihan di lapisan data; hapus berbasis peran (pembuat atau OWNER/ADMIN); rename kelas tahan-gagal dan dapat dilanjutkan; error boundary (`error.tsx`, `global-error.tsx`, `not-found.tsx`).
- **Performa & perawatan:** query analitik berbatas rentang tanggal; paginasi adapter; timestamp dari jam server; logger terstruktur (`lib/utils/logger.ts`, titik sambung Sentry); skema Zod di batas API; tipe model dokumen; `any` di lapisan data berkurang besar.
- **Pengujian:** 910 test unit/rules/DB lolos; 11 suite E2E browser lolos (smoke, onboarding, rename-class, grade-lock, submission, submission-drive-link, attendance, backup, class-tabs, visual, ulangan).

Langkah manual yang masih butuh pemilik project (tidak bisa dari repo):
- Jalankan migrasi `supabase/migrations/20261108000000_harden_submission_bucket.sql` di Supabase.
- Kebijakan TTL Firestore pada koleksi `rate_limits` (field `expiresAt`).
- Uji pembayaran Midtrans Snap di sandbox (CSP, order_id baru yang lebih pendek).
- Deploy rules + indeks (otomatis dari `main`); data lama tanpa `createdBy` hanya bisa dihapus OWNER/ADMIN.

Terbuka: UI Recycle Bin & Audit Log, hapus-terjadwal data terhapus, integrasi Sentry sungguhan, CSP berbasis nonce, `className` → `classId`, pemecahan komponen React besar, `any` tersisa di UI dan `ulanganRepository`.
