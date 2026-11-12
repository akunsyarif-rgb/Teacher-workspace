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


## Pembaruan 12 Nov 2026 — performa bacaan, draf otomatis, per guru (main @ 9ac183e)
Selesai & ter-merge (PR #82, #83; CI hijau):
- Optimasi bacaan Firestore: Beranda (hanya hari ini + agregat + cache perangkat), presensi siswa dan Analitik (sinkron bertahap), daftar kelas (cache perangkat). Biaya model sekolah besar turun dari ±Rp 844 rb ke ±Rp 183 rb/bulan (`docs/LOAD-TEST-ANALISIS.md`).
- Beranda dan Analitik per guru (kelas dari jadwal milik guru + kelas wali; OWNER/ADMIN tetap seluruh workspace di Analitik; data lama tanpa `createdBy` dianggap milik semua guru).
- Draf otomatis di perangkat: nilai, jurnal, pengumuman, tugas, catatan siswa, jawaban tugas siswa (30 hari, dibuang saat keluar akun dengan peringatan).
- Pesan gagal-simpan yang jelas untuk penolakan izin; tes aturan auto-save presensi.
- Insiden 12 Nov: "Missing or insufficient permissions" di Presensi — aturan baru ter-deploy lebih dulu daripada aplikasi (klien lama tanpa `createdBy`). Lihat `docs/AUDIT-KOMPREHENSIF-2026-11-12.txt` bagian 8.
Terbuka (rinci di laporan audit): naikkan Next.js ke 16.4.6 dan dependensi rentan lain, urutan rilis aturan vs aplikasi, langkah manual pemilik, tinjauan hukum Privasi/Syarat, DSN Sentry.


## Panduan: perubahan aturan Firestore — pola "Expand and Contract" (13 Nov 2026)
**Masalah.** `deploy-firestore-rules.yml` men-deploy `firestore.rules` ke Firebase segera setelah `main` berubah, sedangkan bundel aplikasi baru di Vercel siap beberapa menit kemudian dan perangkat (iPad/PWA) bisa menyimpan bundel lama jauh lebih lama. Aturan yang diperketat sebelum semua klien ter-update membuat klien lama gagal dengan "Missing or insufficient permissions" (insiden presensi 12 Nov 2026: aturan mewajibkan `createdBy`, klien lama tidak mengirimnya).

**Aturan main — jangan pernah memperketat dan mengubah klien dalam rilis yang sama.**
1. **Expand (rilis A):** ubah klien agar mengirim/membaca bentuk data BARU, sementara aturan masih menerima bentuk LAMA dan BARU (mis. `createdBy` boleh ada atau tidak). Deploy, tunggu Vercel *Ready*.
2. **Migrasi/backfill (bila perlu):** isi data lama ke bentuk baru; verifikasi tak ada lagi yang berbentuk lama.
3. **Tunggu klien lama habis:** banner "Muat ulang halaman…" (`/api/version`) mendorong pengguna memuat ulang; beri jeda minimal 1–2 hari sekolah (perangkat yang jarang dibuka ikut ter-update) dan pantau galat `permission-denied` di Sentry.
4. **Contract (rilis B):** barulah perketat aturan (hapus dukungan bentuk lama). Rilis ini HANYA mengubah `firestore.rules` (+ tes).
5. **Pelonggaran aman dilakukan kapan saja** (aturan lebih longgar tidak merusak klien lama); **pengetatan tidak**.

**Checklist PR yang menyentuh `firestore.rules`:**
- [ ] Apakah ini memperketat (menolak sesuatu yang dulu diterima)? Jika ya → pecah jadi Expand lalu Contract.
- [ ] Tambahkan/perbarui tes aturan untuk klien LAMA (contoh: `tests/attendance-autosave-rules.test.ts`) dan klien BARU.
- [ ] Indeks baru di `firestore.indexes.json` di-deploy dan selesai dibangun SEBELUM kode yang butuh indeks itu dirilis.
- [ ] Setelah merge: pastikan deployment Vercel *Ready* dan workflow "Deploy Firestore & Storage Rules" sukses.

**Pengaman yang sudah ada:** `/api/version` + banner pembaruan (`src/components/ui/UpdateBanner.tsx`) membandingkan versi build klien dengan server saat halaman dibuka, difokuskan, atau berpindah halaman; pesan gagal-simpan menyuruh muat ulang saat `permission-denied`. Draf lokal (nilai, jurnal, dst.) bertahan saat muat ulang, jadi memuat ulang aman.

## Pembaruan 13 Nov 2026 — dependensi & versi aplikasi
- `next` 16.3.0 → 16.4.6, `firebase` 12.19.0, `firebase-admin` 14.5.1, `eslint-config-next` 16.4.6, `jspdf-autotable` 5.0.9; `dompurify` (transitif jspdf) → 3.4.17. `npm audit --omit=dev`: 0 kerentanan (sebelumnya 2 kritis, 11 tinggi).
- `overrides` di package.json memaksa versi aman untuk transitif yang dipin paket induk: `@grpc/grpc-js` ^1.14.7 (firebase 12.x masih memin ~1.9), `axios` ^1.21.1 + `follow-redirects` ^1.16.3 (midtrans-client), `@fastify/busboy` ^3.2.5, `source-map-js` ^1.2.2. Override `jose` ^5.10.0 DIPERTAHANKAN (lihat catatan ERR_REQUIRE_ESM di package.json). Tinjau override ini saat induknya diperbarui; hapus bila sudah tak perlu.
- CI menjalankan `npm audit --omit=dev --audit-level=high` pada setiap PR. Kerentanan dev-only (brace-expansion, js-yaml, vite) tidak diblokir CI.
- `npm audit fix` di lingkungan ini crash (bug npm: "reading 'edgesOut'"), jadi perbaikan dilakukan lewat pembaruan langsung + overrides.
