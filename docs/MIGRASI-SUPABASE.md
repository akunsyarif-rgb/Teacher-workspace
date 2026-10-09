# Migrasi Firestore → Supabase (Postgres)

Status per 2026-10-09: **skema + RLS sudah ada di Supabase, belum ada data dan belum ada kode aplikasi
yang memakainya.** Aplikasi masih 100% Firestore. Dokumen ini menggantikan versi awal yang keliru
mengira skema belum dibuat.

Aturan kerja (AGENTS.md): tidak ada backfill, dual-write, atau feature flag sebelum persetujuan
eksplisit pemilik. Produksi (project "Workflow") hanya diinspeksi read-only; semua uji mutasi
berjalan di Postgres lokal.

## 1. Kondisi aktual (diverifikasi, read-only)

Project Supabase **Workflow** (`htutgpjcynbnyxwgorcb`):
- 21 tabel di `public`, satu per koleksi Firestore, RLS aktif di semuanya, **0 baris**.
- 19 migrasi (4–5 Okt 2026): skema dasar, kolom pembayaran, pemetaan identitas dari uid Firebase
  (`private.current_uid()` = `auth.jwt()->>'sub'`), trigger kolom immutable, FK dan indeks.
- Fungsi bantu RLS di skema `private`; RPC `claim_student_login_code`, `lookup_workspace_invite`.
- `anon` tidak punya hak apa pun; `authenticated` punya CRUD yang dibatasi RLS (`payments`: SELECT saja).
- Advisor keamanan Supabase: hanya 2 peringatan (dua RPC di atas, memang dipanggil sebelum pengguna jadi
  anggota) dan "leaked password protection" (tidak relevan: login tetap Firebase).
- SQL migrasi **tidak ada di repo**. Salinan baseline hasil ekspor katalog ada di `supabase/baseline/`.

Sisi aplikasi: Firestore hanya disentuh lewat `lib/adapters/firestoreAdapter.ts` (11 fungsi generik)
dan Admin SDK di 6 file server. Tidak ada `onSnapshot`. Belum ada `supabaseAdapter`.

## 2. Hasil audit RLS

Uji paritas: `tests/rls-parity.test.ts` (479 kasus, Postgres lokal, tiap kasus di transaksi yang
di-rollback). Menjalankan baseline produksi + stub `auth.jwt()`, membandingkan perilaku dengan
`firestore.rules` untuk 8 aktor (owner, admin, guru, wali kelas, siswa kelas A, siswa kelas B,
guru workspace lain, tanpa profil) di 21 tabel.

Hasil:
- **Baseline saja: 460 lulus, 19 gagal.** 460 kasus membuktikan paritas dan isolasi tenant (baca/tulis per
  peran, isolasi lintas workspace, pindah workspace ditolak, kunci field plan, catatan konseling hanya
  wali kelas/admin, siswa hanya data kelas/miliknya, kunci submission setelah dinilai, validasi link Drive,
  `payments` tanpa tulis). 19 kegagalan = celah di bawah + fungsi pengganti yang belum ada.
- **Dengan `supabase/migrations/20261009000000_rls_hardening.sql`: 479 lulus.**

### Celah yang terbukti di baseline (ditutup oleh migrasi usulan)
| # | Celah | Bukti | Perbaikan |
|---|---|---|---|
| A | `lookup_workspace_invite` menerima kode undangan LAMA dan mengembalikan kode AKTIF | kode `OLDA` → baris berisi kode aktif | hanya kode yang sama dengan `workspaces.invite_code` |
| B | Guru bisa menulis profil `TEACHER` ke workspace mana pun yang punya undangan aktif, tanpa kode dan melewati batas kursi (juga memungkinkan guru yang dikeluarkan bergabung lagi) | insert/update profil lolos | klaim mandiri TEACHER ditutup; gabung lewat `join_workspace_by_code(kode)` (cek kode, kedaluwarsa, kursi, kunci baris) |
| C | Siapa pun bisa membuat workspace `school_annual` tanpa batas/ plan bulanan gratis | insert lolos | insert hanya plan gratis dengan batas gratis (3 kelas / 1 kursi) |
| D | Siapa pun bisa membuat `student_profiles` palsu untuk workspace/kelas/siswa mana pun lalu membaca data kelas itu | insert lolos | insert langsung dicabut; hanya `claim_student_profile(kode)` |
| E | Siswa bisa mengisi `submissions.score` saat insert | insert lolos | `score is null` pada policy insert |

Migrasi **belum diterapkan** ke produksi dan tidak boleh diterapkan tanpa persetujuan.

### Celah serupa di `firestore.rules` produksi (terbukti di emulator Firestore)
- **G1** `workspaces` create hanya memeriksa `ownerUid`: client bisa membuat workspace dengan
  `plan: 'school_annual'`, `classLimit/seatLimit: null` (paywall terlewati).
- **G2** `student_profiles` create hanya memeriksa uid: client bisa membuat profil siswa palsu untuk
  workspace/kelas mana pun, lalu membaca tugas/jadwal/presensi kelas itu (butuh `workspaceId`, tidak rahasia
  bagi anggota workspace).
- **G3** `teacher_profiles` create/update menerima role `TEACHER` selama undangan workspace aktif
  (tanpa kode, tanpa cek kursi); guru yang dikeluarkan bisa bergabung lagi.
Perbaikan sudah di-merge (PR #57 klien, PR #58 rules) dan rules Firestore ter-deploy lewat workflow
(run #13, langkah Firestore sukses; langkah Storage rules gagal karena API Firebase Storage belum diaktifkan): `workspaces` create hanya plan/batas gratis; profil
siswa wajib cocok dengan dokumen kode login (field `accessCode`, diisi `studentAuthService.claimAccessCode`);
klaim `TEACHER` mandiri dihapus (gabung tetap lewat `/api/workspace/join`). Diverifikasi: uji rules emulator
190 lulus, E2E smoke 19/19, onboarding 11/11, submission 31/31, submission-drive-link 15/15, rename-class 14/14,
attendance-complete-confirm 9/9, grade-lock lulus. Catatan: klien lama yang belum memuat kode terbaru tidak
bisa membuat profil siswa baru sampai refresh (profil yang sudah ada tidak terpengaruh).

### Risiko terbuka lain
- `claim_student_login_code`/`claim_student_profile`: tanpa pembatasan laju; keamanan bergantung pada
  kode acak (sama seperti Firestore). Pertimbangkan rate limit di sisi aplikasi/WAF.
- Siswa bisa mengumpulkan ke tugas kelas lain di workspace yang sama (paritas Firestore; validasi kelas
  hanya di route API). Bisa ditambah ke policy insert.
- `submissions` tidak memeriksa tenggat di RLS (hanya di service); paritas.
- `student_login_codes.id` vs `code`: RPC mencocokkan `id`; backfill harus memastikan `id = code`.

## 3. Yang belum terbukti / butuh dashboard (hambatan, bukan asumsi)
1. **Login Firebase ke Supabase belum terverifikasi.** Skema memetakan `sub` = uid Firebase, tapi Supabase
   (Authentication → Third-party) harus dikonfigurasi untuk Firebase dan token wajib memuat klaim
   `role: "authenticated"` (custom claim Firebase, termasuk untuk siswa anonim). Tanpa itu semua
   request ditolak/anon. Perlu uji dengan token nyata sebelum fase berikutnya.
2. Pemetaan field Firestore → kolom/`metadata` per koleksi belum dibuktikan terhadap data nyata
   (butuh akses baca Firestore). Beberapa field (mis. `subject`, `quickNote`, `isActive`) tidak punya kolom
   dan diharapkan masuk `metadata`.
3. Tipe `bigint` untuk `*_expires_at` (ms) dan `date` untuk tanggal Firestore (string `YYYY-MM-DD`)
   perlu konversi eksplisit di adapter.
4. Keputusan offline: cache persisten Firestore tidak punya padanan; Safari/iOS sudah memakai cache memori.

## 4. Cara menjalankan uji RLS (lokal)
```
RLS_TEST_ADMIN_URL=postgresql://postgres:<pw>@127.0.0.1:5432/postgres npx vitest run tests/rls-parity.test.ts
RLS_TEST_BASELINE_ONLY=1 ... # tanpa migrasi usulan: memperlihatkan celah A–E
```
Butuh Postgres 15+ lokal (bukan Supabase). Tanpa `RLS_TEST_ADMIN_URL` test dilewati (CI tidak punya Postgres).
`supabase/test-support/000_auth_stub.sql` hanya untuk uji lokal; jangan dijalankan di Supabase.

## 5. Langkah berikutnya (urut)
1. Tinjau dan setujui `20261009000000_rls_hardening.sql`; terapkan dulu ke branch/project staging Supabase
   (bukan Workflow produksi), jalankan ulang `tests/rls-parity.test.ts` terhadap staging.
2. Verifikasi login Firebase ↔ Supabase (butir 3.1) dengan token guru dan siswa anonim nyata.
3. ~~G1–G3 Firestore~~ selesai (PR #57, #58).
4. Tulis `supabaseAdapter` (antarmuka sama dengan `firestoreAdapter`) di balik flag per koleksi, default mati.
5. Backfill + dual-write satu koleksi percobaan (`session_skip_reasons`) — hanya setelah persetujuan.
6. Server (6 file Admin SDK), koleksi inti satu per satu, lalu pensiun Firestore.

Rollback tiap fase: matikan flag koleksi itu; Firestore tetap sumber kebenaran sampai fase terakhir.

## 6. Pertanyaan terbuka untuk pemilik
1. Setujui migrasi hardening (bagian 2) untuk diuji di staging?
2. Boleh dibuatkan project/branch Supabase staging terpisah (bukan Workflow)? Mungkin berbiaya.
3. (selesai) G1–G3 Firestore sudah di-merge dan ter-deploy.
4. Offline penuh di Chrome/Android wajib dipertahankan setelah migrasi?

## 7. Verifikasi autentikasi Firebase → Supabase (dijalankan LOKAL oleh pemilik)

Temuan konfigurasi: repo **tidak** menyetel claim `role: "authenticated"` di mana pun (tidak ada `setCustomUserClaims`
atau blocking function). Supabase Third-Party Auth menolak token tanpa claim `role`, jadi tanpa langkah 1b di bawah
semua permintaan akan 401 meski provider sudah ditambahkan.

### Tindakan dashboard (sekali)
1. **Supabase** (project Workflow) → Authentication → Sign In / Providers → **Third-Party Auth** → Add provider → **Firebase** →
   isi Firebase Project ID (harus sama dengan `aud` token).
2. **Claim role** — pilih satu (butuh keputusan Anda; belum diimplementasi):
   - Firebase Authentication dengan Identity Platform → blocking function `beforeUserCreated` + `beforeSignIn` yang mengembalikan
     `customClaims: { role: 'authenticated' }` (mencakup guru dan siswa anonim sejak token pertama); atau
   - endpoint server kecil (Admin SDK `setCustomUserClaims(uid, {role:'authenticated'})`) yang dipanggil setelah login lalu
     klien `getIdToken(true)` — tanpa Identity Platform, tapi ada satu langkah tambahan per sesi.

### Jalankan di terminal Anda (token tidak pernah dicetak, tidak perlu ditempel ke percakapan)
```bash
export SUPABASE_URL=https://htutgpjcynbnyxwgorcb.supabase.co
export SUPABASE_PUBLISHABLE_KEY=...        # kunci publik (Dashboard → API Keys)
export FIREBASE_WEB_API_KEY=...            # NEXT_PUBLIC_FIREBASE_API_KEY
export TEACHER_EMAIL=...                   # akun guru UJI
read -s TEACHER_PASSWORD && export TEACHER_PASSWORD   # ketik sandi, tidak tampil/tersimpan di history
node scripts/supabase/verify-auth.mjs                  # guru + siswa anonim, terpisah
node scripts/supabase/verify-auth.mjs --skip-teacher   # hanya siswa anonim
```
Yang diperiksa per identitas: `iss`/`aud`, `sub`, **claim `role`**, provider (`password` vs `anonymous`), kedaluwarsa;
kontrol negatif (tanpa token → tak ada data; token sampah → 401); lalu `rpc/auth_probe` (butuh migrasi
`20261009000100_auth_probe.sql`; bila belum ada, otomatis memakai GET `teacher_profiles`) untuk memastikan Supabase membaca
`role` dan `sub` yang sama; terakhir isolasi RLS (hanya jumlah baris). Exit code 0 lulus / 1 gagal / 2 konfigurasi kurang.
Skrip hanya GET dan satu RPC read-only; ia membuat satu user anonim Firebase (sama seperti login siswa biasa).
Hasil yang boleh dibagikan: baris `PASS/FAIL` di keluaran (sudah diredaksi dari JWT, sandi, dan kunci).

## 8. Paket validasi staging

**Prasyarat (butuh persetujuan Anda; berbayar):** project/branch Supabase non-produksi. Opsi: Supabase branch dari Workflow
(`create_branch`, perlu konfirmasi biaya) atau project baru. Jangan Workflow produksi, jangan SmadaExam.

### 8.1 Uji lokal (sudah bisa, tanpa biaya) — database kosong, idempoten, rollback
```bash
export RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres   # Postgres 16 lokal
npx vitest run tests/rls-parity.test.ts        # 479 kasus RLS/RPC/grant/trigger terhadap baseline + migrasi
npx vitest run tests/rls-migration.test.ts     # kosong→terapkan, terapkan 2×, rollback=baseline, terapkan lagi, auth_probe
RLS_TEST_BASELINE_ONLY=1 npx vitest run tests/rls-parity.test.ts   # membuktikan celah ada tanpa migrasi (19 gagal)
```

### 8.2 Urutan di staging
1. Buat staging, pastikan kosong atau berisi salinan baseline. Catat ref-nya (jangan `htutgpjcynbnyxwgorcb` / `abdkrhmxfpcmgzsxzfyz`).
2. Bila staging project kosong (bukan branch): `psql "$STAGING_DB_URL" -f supabase/baseline/001_schema.sql -f .../002_functions_triggers.sql -f .../003_rls_policies_grants.sql`
   (JANGAN `supabase/test-support/000_auth_stub.sql` — Supabase sudah punya skema `auth`).
3. Terapkan `supabase/migrations/20261009000000_rls_hardening.sql` lalu `20261009000100_auth_probe.sql` (bisa diulang; idempoten, diuji).
4. Verifikasi katalog: `select policyname from pg_policies where tablename in ('workspaces','student_profiles','submissions');`
   harus memuat `workspaces_owner_insert`, `submissions_student_insert`, tanpa `student_profiles_self_insert`.
5. Jalankan `tests/rls-parity.test.ts` terhadap staging dengan harness yang sama (fixture memakai skema sementara; untuk staging
   nyata jalankan `scripts/supabase/verify-auth.mjs` dengan SUPABASE_URL staging dan akun uji).
6. Backfill uji: `scripts/migration/backfill-skip-reasons.ts` (PR #60) dengan `SUPABASE_ALLOWED_REFS=<ref staging>`.

### 8.3 Produksi (HANYA setelah staging lulus + persetujuan eksplisit)
- **Backup** (wajib, sebelum apa pun): Dashboard → Database → Backups (catat waktu), dan `pg_dump --format=custom --no-owner "$PROD_DB_URL" > workflow-$(date +%F).dump`
  disimpan di luar repo. Tabel produksi saat ini 0 baris, jadi pemulihan = skema + policy.
- **Terapkan**: satu transaksi per file (`psql -1 -f ...`), urutan sama seperti 8.2 butir 3.
- **Verifikasi pasca-migrasi**: query katalog 8.2 butir 4; `select public.auth_probe();` dengan token uji (lewat `verify-auth.mjs`);
  `get_advisors` (security) tanpa temuan baru; klien lama tetap jalan karena Firestore masih sumber data.
- **Rollback**: `psql -1 -f supabase/rollback/20261009000100_auth_probe_down.sql -f supabase/rollback/20261009000000_rls_hardening_down.sql`
  (diuji: katalog kembali persis sama dengan baseline). Ini membuka lagi celah A–E, jadi hanya untuk regresi fungsional;
  untuk kerusakan data pakai `pg_restore` dari backup.
