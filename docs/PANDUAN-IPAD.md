# Panduan manual dari iPad (Safari) — Teacher Workspace → Supabase

Semua langkah memakai browser, GitHub, Firebase Console, Supabase Dashboard, dan Vercel. **Jangan kirim kunci/secret/token ke chat.** Nilai rahasia hanya disalin dari satu layar dan ditempel ke layar lain.
Nama menu bisa sedikit berbeda antar versi dashboard; jika tidak ketemu, gunakan kotak pencarian dashboard (ikon kaca pembesar) dengan kata kunci yang dicetak **tebal**.

Urutan prioritas: **M1 → M2 → M3 → (persetujuan) → M4.**

---
## M1 — Konfigurasi autentikasi (± 20 menit)
**Keputusan:** claim `role: "authenticated"` dipasang oleh **endpoint server kita** memakai **Firebase Admin SDK** (`setCustomUserClaims`). **Tidak perlu Firebase Identity Platform**, tidak perlu migrasi Firebase Auth, tidak perlu Cloud Functions. Berlaku untuk guru **dan** siswa anonim. (Alternatif blocking function butuh upgrade Identity Platform + Cloud Functions — lebih rumit, tidak dipilih.)
Kode endpoint sudah ada (`/api/auth/supabase-claim`) dan **mati secara default**.

### M1.1 Ambil Firebase Project ID (bukan rahasia)
1. Buka console.firebase.google.com → pilih proyek Teacher Workspace.
2. Ikon roda gigi ⚙ di samping **Project Overview** → **Project settings**.
3. Tab **General** → baris **Project ID** → catat teksnya (contoh bentuk: `nama-proyek-12345`).

### M1.2 Aktifkan Third-Party Auth di Supabase Workflow
1. supabase.com/dashboard → pilih project **Workflow** (BUKAN SmadaExam — periksa nama di kiri atas).
2. Menu kiri **Authentication** → **Sign In / Providers** (di beberapa versi: **Third-Party Auth**). Gulir ke bagian **Third-Party Auth**.
3. **Add provider** → pilih **Firebase** → isi **Firebase Project ID** dengan nilai M1.1 → **Save/Create**.
4. Verifikasi: Firebase muncul di daftar provider dengan Project ID yang benar.

### M1.3 Ambil Project URL dan Publishable key Supabase (publik, aman di browser)
1. Supabase (project Workflow) → **Project Settings** (roda gigi kiri bawah) → **API Keys** (atau **API**).
2. Salin **Project URL** (`https://htutgpjcynbnyxwgorcb.supabase.co`) dan **Publishable key** (diawali `sb_publishable_`). **Bukan** secret key / service_role.

### M1.4 Isi variabel lingkungan di Vercel (**Preview saja dulu**)
1. vercel.com → proyek Teacher Workspace → **Settings** → **Environment Variables**.
2. Tambah (centang **hanya Preview**, "All Preview Branches"; hilangkan centang Production & Development):
   | Nama | Nilai | Sumber |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | M1.3 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) | M1.3 |
   | `ENABLE_SUPABASE_CLAIM` | `yes` | ketik sendiri |
3. **Wajib sudah ada untuk Preview** (periksa; jika kolom Environments tidak mencakup Preview, edit dan centang Preview — jangan ubah nilainya):
   - `FIREBASE_ADMIN_SERVICE_ACCOUNT` — JSON lengkap service account Firebase **proyek yang sama** dengan `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (jika beda proyek, semua token ditolak 401). Endpoint memakainya untuk memverifikasi token DAN mengubah claim, jadi service account perlu izin mengubah pengguna Firebase Auth. Service account bawaan `firebase-adminsdk-…@<proyek>.iam.gserviceaccount.com` sudah punya. Jika Anda memakai service account khusus (mis. yang hanya untuk deploy rules) dan langkah M2 "Claim role" gagal dengan pesan izin: Google Cloud Console → **IAM & Admin** → **IAM** → cari service account itu → ikon pensil → **Add another role** → **Firebase Authentication Admin** → Save.
   - Variabel klien Firebase yang sudah dipakai aplikasi: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` (dst.) — sudah ada bila Preview bisa dipakai login.
   - **TIDAK diperlukan** untuk M1/M2: `SUPABASE_URL` dan `SUPABASE_SECRET_KEY` (itu hanya untuk unggah lampiran tugas yang sudah berjalan) — jangan disalin ke tempat lain.
   Catatan: nilai `NEXT_PUBLIC_*` ditanam saat build, dan perubahan env hanya berlaku untuk deployment BARU → wajib Redeploy (M1.5).
4. **Jangan** mengisi `NEXT_PUBLIC_SUPABASE_COLLECTIONS` dan variabel `*_AUTH_VERIFIED` sekarang — flag tetap mati.

### M1.5 Deploy Preview
GitHub → PR #60 → komentar bot **Vercel** → **Visit Preview** (atau Vercel → Deployments → deployment Preview terbaru → ⋯ → **Redeploy** agar env baru terbaca). Catat alamat Preview (`https://…vercel.app`).
Pastikan domain Preview ada di Firebase Console → **Authentication** → **Settings** → **Authorized domains** (biasanya sudah, karena Preview pernah Anda pakai).

---
## M2 — Validasi aman (read-only; ± 15 menit)
Semua uji di bawah **hanya membaca** dan tidak menampilkan token. Satu-satunya "tulis" adalah memasang claim role pada akun yang sedang diuji.
1. **Guru:** buka alamat Preview → masuk dengan akun guru → ganti alamat jadi `…/cek-supabase` → **Uji sesi saya**.
2. **Siswa anonim:** buka **tab privat** → alamat Preview `…/cek-supabase` → **Uji sebagai siswa anonim** → setelah selesai tekan **Hapus akun uji**.
3. **Cara membaca hasil:**
   | Baris | ✅ berarti | Jika ❌ |
   |---|---|---|
   | Konfigurasi publik | URL/key terbaca, project benar | isi M1.4 lalu Redeploy |
   | Sesi Firebase | guru / siswa anonim terdeteksi | masuk dulu |
   | Claim role | endpoint memasang claim (jika ❌ 501: baca pesan — memuat penyebab, cabang, dan commit deployment; "TIDAK ADA di deployment ini" = env belum terbaca → pastikan Environment Preview, nama persis `ENABLE_SUPABASE_CLAIM`, lalu **Redeploy** deployment BARU; "nilainya bukan yes" = isi persis `yes`) | `ENABLE_SUPABASE_CLAIM=yes` belum aktif di Preview, atau `FIREBASE_ADMIN_SERVICE_ACCOUNT` kosong |
   | Tanpa login: tidak ada akses data | pengunjung anonim ditolak | **hentikan**, laporkan |
   | Supabase menerima token | **bukti layanan nyata**: Third-Party Auth + role bekerja | Project ID di M1.2 salah/ belum disimpan |
   | Identitas terpetakan | uid Supabase = uid Firebase | ℹ️ = migrasi belum dipasang (normal sebelum persetujuan) |
   | RLS … | jumlah baris yang terlihat akun ini | ❌ = izin ditolak |
4. **Bukti bahwa ini benar-benar Supabase (bukan mock):** Supabase → **Logs** (atau **Logs & Analytics**) → **API Gateway/Edge Logs** → filter `teacher_profiles`: permintaan baru dengan status 200 muncul pada menit uji Anda.
5. **RLS & RPC terhadap Supabase nyata:** baris "Identitas" ✅ dan uji tulis memerlukan migrasi #59 terpasang di Workflow. **Tabel Workflow kosong (0 baris); yang dipakai produksi hanya Storage bucket `submission-attachments` (6 objek), dan migrasi tidak menyentuh Storage.** Cukup beri saya persetujuan (lihat bawah) agar migrasi + uji tulis dengan data uji dijalankan lewat alat Supabase saya dan hasilnya dilaporkan. Tidak perlu project staging berbayar.
6. **Uji tulis hanya dengan persetujuan:** tidak ada uji tulis ke produksi tanpa rencana: (a) migrasi `0000–0300` ke Workflow (kosong), (b) di Preview dengan flag Preview-only dan **akun uji baru**, buat workspace "UJI", tambah kelas/siswa, login siswa; (c) setelah selesai baris uji dihapus.

---
## M3 — Kuota workspace SMAN 2 Tarakan
**Rekomendasi (sesuaikan dengan jumlah nyata):** `seatLimit = 100`, `classLimit = 60`.
- Dasar: SMA 3 angkatan ≈ 30–40 rombel dan ± 60–80 guru, ditambah ruang tumbuh ×1,5. `seatLimit` finite (bukan tak terbatas) sengaja: bila kode undangan bocor, jumlah yang bisa bergabung tetap terbatas (kode kedaluwarsa 7 hari; bisa dibuat ulang).
- `classLimit` dihitung dari **nama kelas unik** pada data siswa, jadi salah ketik nama kelas ikut terhitung — beri ruang.
- Ganti angka bila jumlah guru/rombel Anda jelas berbeda.

**Lokasi pengaturan (produksi saat ini = Firestore):**
1. Firebase Console → **Firestore Database** → tab **Data** → koleksi **workspaces** → pilih dokumen yang `name`-nya sekolah Anda (**catat Document ID** — itu `workspace_id` untuk backfill).
2. Edit field `seatLimit` (number) = 100 dan `classLimit` (number) = 60 → **Update**. Jika field belum ada: **Add field** → tipe **number**.
3. Nilai lama (untuk dikembalikan): biasanya `seatLimit` 1, `classLimit` 3.
- Alternatif `/owner` (Panel Pemilik) **jangan diandalkan**: butuh `APP_OWNER_UIDS` di Vercel dan deployment produksi terbaru; periksa dulu dengan membuka `…/owner` (jika "khusus pemilik aplikasi" artinya env belum diisi).
- Setelah cutover (Supabase): Supabase → **Table Editor** → tabel **workspaces** → baris sekolah → edit `seat_limit`, `class_limit`.
**Prasyarat/dampak:** perubahan langsung berlaku (tanpa deploy); hanya guru yang memegang kode undangan yang bisa bergabung sampai batas itu; lakukan **sebelum backfill** agar nilai tersalin. Tidak ada pembayaran terkait.

---
## M4 — Cutover (detail teknis: `docs/CUTOVER-SUPABASE.md`)
Ringkas: **satu jendela** (bukan koleksi demi koleksi — firestore.rules bergantung pada profil guru di Firestore). Urutan: gerbang G1–G6 → backfill bertahap (identity → teacher → school → students → submissions) dari GitHub Actions → jendela pembekuan 20 menit → backfill delta bersih → isi env Production + Redeploy → uji → pantau. Rollback: hapus flag + Redeploy, lalu `reverse-apply`.

**Siapkan GitHub Actions dari iPad (sekali):**
1. GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, tambah: `SUPABASE_URL` (Project URL), `SUPABASE_SECRET_KEY` (Supabase → Project Settings → API Keys → **Secret key** → Reveal → salin), `SUPABASE_ALLOWED_REFS` = `htutgpjcynbnyxwgorcb`. `FIREBASE_SERVICE_ACCOUNT` sudah ada (dipakai deploy rules); jika izinnya kurang untuk membaca Firestore, ganti isinya dengan JSON service account Admin SDK yang sama seperti di Vercel (Firebase Console → Project settings → **Service accounts** → **Generate new private key** → buka file di Files → salin isi → tempel ke secret).
2. (Disarankan) **Settings** → **Environments** → **New environment** `supabase-cutover` → **Required reviewers** = Anda: setiap run butuh satu ketukan persetujuan.
3. Jalankan uji: **Actions** → **Supabase backfill / rollback data** → **Run workflow**: koleksi `identity`, `workspace_id` dari M3, mode **dry-run**. Hasil: ringkasan tabel jumlah di halaman run.
**Yang memerlukan persetujuan Anda sebelum menyentuh produksi:** lihat bagian 5 `CUTOVER-SUPABASE.md`.
