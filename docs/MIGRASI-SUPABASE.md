# Rencana Migrasi Firestore → Supabase (Postgres)

Status: **usulan, belum disetujui, tidak ada perubahan data atau kode aplikasi.**
Dokumen ini hanya Fase 0 (perencanaan). Setiap fase berikutnya butuh persetujuan eksplisit
pemilik (lihat AGENTS.md: breaking change dan migrasi data wajib disetujui lebih dulu).

## Tujuan
Kemudahan maintenance dan pengembangan:
- Asisten pengembang (Claude) bisa membaca tabel, menjalankan SQL, melihat log, dan membuat
  migrasi skema langsung lewat konektor Supabase, tanpa pemilik membuka Console tiap kali.
- Skema dan aturan akses tercatat sebagai migrasi SQL di git (bisa direview, diuji, dibatalkan).
- Laporan/statistik cukup dengan SQL, tanpa membaca dokumen satu per satu.

Bukan tujuan: mengganti Firebase Auth, mengubah fitur, atau memindahkan lampiran
(lampiran siswa sudah di Supabase Storage, lihat PR #50).

## Kondisi saat ini (fakta dari repo)
- 21 koleksi Firestore: `teacher_profiles`, `workspaces`, `workspace_invites`, `payments`,
  `students`, `schedules`, `journals`, `session_skip_reasons`, `academic_years`, `attendances`,
  `grades`, `grade_columns`, `assignments`, `announcements`, `submissions`,
  `student_login_codes`, `student_profiles`, `class_fund_transactions`, `class_inventory`,
  `student_notes`, `student_achievements`.
- `firestore.rules`: 717 baris (multi-tenant per `workspaceId`, peran OWNER/ADMIN/TEACHER,
  akses siswa lewat `student_profiles`). Ini bagian paling rawan saat dipindah.
- Lapisan kode: UI → Controller → Service → Repository (22 file) → **`lib/adapters/firestoreAdapter.ts`**.
  Hanya adapter itu (dan `src/config/firebase.ts`) yang memakai SDK Firestore klien.
  Adapter hanya ~11 fungsi generik: `getDocument(s)`, `countDocuments`, `addDocument`,
  `setDocument`, `updateDocument`, `deleteDocument`, `batchWrite`, `generateId`, cache.
- Tidak ada `onSnapshot` (tanpa listener realtime): semua baca/tulis berbentuk request-response.
- Admin SDK (server) dipakai di 6 file: `lib/server/{firebaseAdmin,classAdminService,paymentService,workspaceAdminService,ownerAdminService}.ts` dan route API terkait.
- Login: Firebase Auth (guru email-password, siswa anonim + kode akses). Tidak ikut dipindah.
- Offline: cache persisten Firestore (kecuali Safari/iOS yang memakai cache memori).

## Keputusan arsitektur yang diusulkan
1. **Pertahankan Firebase Auth.** Supabase mendukung Firebase sebagai penyedia login pihak ketiga:
   token Firebase dipakai langsung ke Supabase, `auth.jwt()->>'sub'` = uid Firebase.
   Menghindari migrasi akun dan login ulang semua pengguna.
2. **Tulis `supabaseAdapter` dengan antarmuka yang sama** dengan `firestoreAdapter`, dipilih lewat
   env (`DATA_BACKEND=firestore|supabase`) per koleksi (feature flag). Service/Repository tidak diubah.
3. **Skema:** satu tabel per koleksi, `id text primary key` (id Firestore dipertahankan),
   `workspace_id text not null` di semua tabel tenant, `created_at/updated_at timestamptz default now()`,
   kolom jelas untuk field yang sering difilter, `jsonb` untuk field lepas/jarang.
4. **RLS** menggantikan `firestore.rules`: fungsi `current_workspace_id()` (dari `teacher_profiles`),
   `current_role()`, `is_student_in_class(...)`. Field immutable (`workspace_id`, `created_by`,
   `created_at`) dijaga trigger. Setiap aturan lama dipetakan 1:1 dan diuji.
5. **Operasi server-only** (join workspace, rename kelas, pembayaran, panel admin/pemilik) dipindah
   ke fungsi/RPC Postgres atau tetap di route API memakai `service_role`.

## Fase
| Fase | Isi | Risiko | Gerbang persetujuan |
|---|---|---|---|
| 0 | Dokumen ini + inventarisasi field per koleksi | tidak ada | pemilik menyetujui arah |
| 1 | Skema + RLS + test RLS untuk 1 koleksi percobaan non-kritis (mis. `session_skip_reasons`) di project **terpisah/branch Supabase**; `supabaseAdapter` + flag; data baru ditulis ganda (dual-write) | rendah | persetujuan sebelum menyentuh data produksi |
| 2 | Backfill data koleksi percobaan, bandingkan hasil, ganti baca ke Supabase untuk koleksi itu | sedang | persetujuan tiap koleksi |
| 3 | Koleksi inti satu per satu (`workspaces`, `teacher_profiles`, `students`, ... ) dengan pola yang sama | tinggi (multi-tenant) | persetujuan tiap koleksi |
| 4 | Pensiunkan Firestore + `firestore.rules`, hapus dual-write | sedang | persetujuan akhir + backup |

Rollback tiap fase: matikan flag koleksi itu; Firestore tetap sumber kebenaran sampai Fase 4.

## Risiko dan hal yang hilang
- **Offline:** antrean tulis offline Firestore tidak punya padanan langsung di Supabase. Bila fitur
  offline penuh harus dipertahankan, perlu antrean tulis sendiri di klien (pekerjaan tambahan).
- **Transaksi/batch:** `batchWrite` harus jadi transaksi (RPC) agar tetap atomik.
- **Timestamp:** `serverTimestamp()` → `default now()` + trigger; jangan percaya waktu klien (AGENTS.md).
- **Kebocoran antar-sekolah:** kesalahan RLS = data satu sekolah terbaca sekolah lain. Wajib ada test
  RLS per tabel setara `tests/firestore-rules.test.ts` sebelum koleksi apa pun dialihkan.
- **Biaya dan operasi:** Supabase punya batas plan (koneksi, ukuran DB); perlu backup terjadwal.
- **Dua sistem sekaligus** selama fase 1-3: lebih banyak hal untuk dirawat sementara.

## Perkiraan usaha (kasar, untuk perencanaan, bukan janji)
Fase 1: beberapa hari. Fase 2: sekitar satu minggu. Fase 3: beberapa minggu (21 koleksi, 717 baris
rules untuk dipetakan dan diuji). Fase 4: beberapa hari.

## Alternatif yang lebih murah (untuk masalah "bolak-balik buka Console")
- Beri asisten akses **baca saja** ke Firebase (service account read-only di environment sesi).
- Panel pemilik `/owner` untuk mengubah plan/kuota tanpa Console (PR terpisah).

## Pertanyaan terbuka untuk pemilik
1. Apakah fitur offline penuh (tulis saat offline bertahan setelah tab ditutup) wajib dipertahankan?
2. Koleksi percobaan mana yang boleh dipindah dulu?
3. Boleh membuat project/branch Supabase terpisah untuk uji (bukan project Workflow yang berisi bucket produksi)?
4. Tenggat atau alasan biaya yang mendorong migrasi (agar fase bisa diprioritaskan)?
