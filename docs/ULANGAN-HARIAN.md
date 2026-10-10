# Ulangan Harian (Supabase) — arsitektur, keputusan, status

Status: **kode selesai + tes lokal lulus. BELUM diterapkan ke Supabase Workflow. BELUM aktif di produksi.** Branch: `feat/ulangan-harian-supabase`.

## Arsitektur (mengikuti pola TW yang sudah ada)
```
Guru / Siswa (browser)
  └─ halaman: app/ulangan (guru), app/student/ulangan (siswa)  →  controller → service → repository
        └─ fetch POST /api/ulangan  + ID token Firebase                       ← klien TIDAK memanggil Supabase
              └─ app/api/ulangan/route.ts  (Next.js, runtime nodejs)
                    1. verifikasi ID token (Admin SDK)                         ← uid hanya dari token
                    2. identitas dari FIRESTORE (sumber kebenaran TW): teacher_profiles/workspaces, student_profiles/students
                       (lib/server/ulanganAuth.ts) — workspace, peran, siswa, kelas TIDAK dari body
                    3. lib/server/ulanganActions.ts: validasi + (guru) kelas harus ada di workspace → RPC Supabase (service_role)
                          └─ Supabase (Postgres): tabel ulh_* + RPC ulh_* (SECURITY DEFINER, EXECUTE hanya service_role)
```
- **Login:** guru = Firebase email/password (`/signup` membuat workspace); siswa = Firebase anonim + kode akses (`student_profiles/{uid}`). Tidak diubah.
- **Kelas & siswa:** tetap di Firestore (`students`: `workspaceId`, `className`, `name`). Daftar kelas di UI guru memakai `fetchClassSummaries` yang sudah ada. Tidak ada salinan identitas/kelas di Supabase.
- **Precedent:** route `submission-attachments` sudah memakai pola yang sama (token Firebase diverifikasi di server → Supabase dengan secret key).
- **Supabase hanya untuk data ulangan** (ulangan, soal, kunci, pengerjaan, jawaban, kejadian integritas). Data akademik lain tidak dipindah. Flag migrasi `NEXT_PUBLIC_SUPABASE_*` tidak dipakai modul ini.
- **Mandiri:** kode ulangan tidak mengimpor dan tidak mengubah file PR #59/#60 (helper Supabase sendiri: `lib/server/ulanganSupabase.ts`, hanya RPC `ulh_*`, SmadaExam ditolak; harness tes sendiri). Migrasinya tidak memerlukan SQL PR #59. Hanya menyentuh file bersama: `package.json` (1 skrip), `app/page.tsx` & `app/student/page.tsx` (1 tautan menu bila flag aktif), `.env.local.example`.

## Keputusan fitur
| Keputusan | Isi |
|---|---|
| **Dipertahankan** | Pilihan ganda 2–6 opsi, bobot poin; kelas + jadwal (buka/tutup) + durasi; terbit/tutup/hapus draft; timer server (`expires_at = least(mulai+durasi, tutup)`); autosave idempoten + monoton (`client_seq`); submit idempoten; penilaian server (skor 0–100); hasil & status per siswa (termasuk yang belum mulai); kunci jawaban terpisah & tak pernah dikirim ke siswa; tolak jawaban/submit setelah batas waktu |
| **Disederhanakan** | Paket soal/bank terpisah → soal langsung di dalam ulangan (satu form). Tabel blueprint acak → acak stabil dari hash id attempt (tanpa tabel). Proyeksi identitas + sinkronisasi + TTL + pembatas durable + tabel `ulh_members/roster/rate_buckets` + audit log → **dihapus** (identitas dibaca dari Firestore saat dibutuhkan). Endpoint `claim role` & klien PostgREST → tidak dipakai. 18 RPC → 14. Siswa pindah perangkat: login ulang (uid anonim baru) mengambil alih pengerjaan **aktif** yang sama |
| **Dipertahankan tapi bukan jalur kritis** | Peringatan integritas (keluar halaman >3 dtk; tingkat 1/2/3 oleh server; indikasi, bukan sanksi; tanpa sanksi otomatis) |
| **Ditunda** | Bank soal/duplikasi ulangan, remedial, esai/gambar, ekspor, realtime (monitor = muat ulang 15 dtk), audit log, pembatas laju (gunakan Vercel Firewall/App Check), proktor, edit ulangan terbit |

## Keamanan
- RPC: `SECURITY DEFINER`, `search_path` kosong, `EXECUTE` hanya `service_role`; tabel RLS aktif tanpa policy dan tanpa grant (di Workflow `service_role` memang tanpa hak tabel — terverifikasi read-only — jadi ia hanya bisa memanggil RPC).
- Parameter aktor (workspace/uid/siswa/kelas/admin) dipercaya hanya karena hanya server yang bisa memanggil RPC; server menurunkannya dari token + Firestore. Body request tidak pernah menentukan aktor; field asing dibuang.
- Guru: hanya pembuat atau OWNER/ADMIN workspace; workspace harus ada, OWNER harus cocok `ownerUid`. Siswa: kelas dari dokumen `students`, workspace harus cocok.
- Attempt-level (autosave/submit): kepemilikan = `user_id` = uid token; tanpa baca Firestore.
- Pencabutan token (`checkRevoked`) hanya untuk aksi penentu hak (guru, daftar/mulai siswa).
- `FORCE ROW LEVEL SECURITY` tidak dipakai: `postgres` di Workflow BYPASSRLS (terverifikasi), dan tanpa FORCE juga benar bila tidak; dengan FORCE pada pemilik tanpa BYPASSRLS RPC akan gagal (dibuktikan tes).

## Tes (semua LOKAL — bukan Supabase nyata)
- `ulangan-db` (44): RPC/grant/definer/search_path/kunci/skor/timer/autosave/integritas/hasil pada 3 mode pemilik + bukti FORCE RLS.
- `ulangan-migration` (6): migrasi hanya menambah objek `ulh_*`, rollback mengembalikan katalog persis, penerapan ganda gagal tanpa efek, mandiri (tanpa fungsi luar, tanpa grant ke klien, tanpa policy).
- `ulangan-postgrest` (3): PostgREST resmi v12.2.3 — alur penuh lewat aksi server + RPC via HTTP; klien/anon/JWT palsu tak punya jalan; 14 RPC terekspos.
- `ulangan-server` (12): identitas dari Firestore, aktor tak bisa dipalsukan, kelas harus ada, pemetaan galat (22xxx→400), tanpa kebocoran log, rekap.
- `ulangan-supabase` (6): jalur server→Supabase: hanya RPC `ulh_*`, URL divalidasi, SmadaExam ditolak, secret tak bocor. `ulangan-verify-sql` (2): verifikasi katalog read-only + 13 kontrol negatif.
- `ulangan-client` (7), `workspace-server-supabase`, `rls-parity`, `rls-migration`.
- **E2E browser** `npm run test:e2e:ulangan` (22 langkah): guru membuat & menerbitkan, siswa mengerjakan (peringatan integritas, autosave, reload, pindah perangkat, submit), guru melihat hasil. Gateway lokal menggantikan gateway Supabase (hanya untuk server). Belum di CI.
- CI: `.github/workflows/ulangan-db-tests.yml` (push ke branch ini / PR / manual): Postgres + PostgREST di runner, tanpa secret.
- Jalankan lokal: `POSTGREST_BIN=... RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-*.test.ts`

## Konfigurasi Preview (Vercel → Settings → Environment Variables → **hanya Environment "Preview"**)
| Variabel | Nilai | Catatan |
|---|---|---|
| `NEXT_PUBLIC_ULANGAN_ENABLED` | `yes` | Dibaca saat **build** (juga oleh route). Production dibiarkan kosong → `/api/ulangan` 501 dan menu tersembunyi |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Server-only. Sudah ada untuk lampiran tugas; **target harus project yang menerima migrasi ulangan** (SmadaExam ditolak otomatis) |
| `SUPABASE_SECRET_KEY` | secret key | **Server-only**, tanpa awalan `NEXT_PUBLIC_`. Terverifikasi tidak ada di bundle browser maupun artefak build (uji sentinel) |
| `FIREBASE_ADMIN_SERVICE_ACCOUNT` | JSON | Sudah ada; dipakai verifikasi token + baca Firestore |
Tidak diperlukan lagi: `ENABLE_SUPABASE_CLAIM`, `NEXT_PUBLIC_SUPABASE_*`, flag koleksi migrasi. Setelah mengubah env: **Redeploy** Preview (NEXT_PUBLIC_* terbaca saat build).
Catatan: bila Preview dan Production berbagi `SUPABASE_URL` yang sama, data ulangan ikut ada di database yang sama, tetapi Production tetap mati lewat flag (build tanpa flag).

## Urutan integrasi (tanpa merge — rekomendasi)
- Modul ini **mandiri** terhadap #59/#60, jadi urutan merge bebas. Disimulasikan: bila #59/#60 di-**squash**-merge ke main, merge branch ini ke main konflik hanya pada 3 file milik mereka yang dulu saya ubah (`supabaseServer.ts`, `tests/rls/harness.ts`, `tests/workspace-server-supabase.test.ts`); file-file itu **sudah dikembalikan identik dengan #59/#60**, sehingga konflik itu tidak ada lagi.
- Karena branch ini masih memuat riwayat merge #59/#60, PR-nya akan memuat perubahan mereka sampai keduanya merge. Urutan paling aman: **#59 → #60 → (update branch dari main) → PR ulangan** — diff PR ulangan lalu hanya berisi file ulangan. Alternatif: ambil hanya commit ulangan ke branch baru dari main (cherry-pick / `git diff b79221c HEAD`), karena tidak ada dependensi ke #59/#60 (tes migrasi memakai skema #59 hanya bila ada).
- SQL: migrasi ulangan tidak bergantung pada migrasi #59 (hasil katalog identik diterapkan sebelum/sesudah #59).

## Validasi di lingkungan terisolasi (gratis) dan sesudah penerapan
1. **Lokal/CI (sudah tersedia, tanpa Supabase):** `scripts/ulangan/validate-isolated.sh [--e2e]` (menolak host non-lokal) — menjalankan seluruh tes ulangan, `--e2e` menambah e2e browser. CI: `.github/workflows/ulangan-db-tests.yml`.
2. **Setelah ada persetujuan terapkan ke project target (belum dilakukan):**
   a. Terapkan `supabase/migrations/20261010000000_ulangan_harian.sql` (aditif; rollback: `supabase/rollback/…_down.sql` menghapus semua data ulangan).
   b. Jalankan `supabase/verify/ulangan_post_migration.sql` (READ-ONLY; psql atau SQL editor) → 15 baris, **semua PASS** (14 RPC definer + search_path kosong + EXECUTE hanya service_role; 8 tabel RLS aktif tanpa hak/policy; kunci jawaban hanya di 3 fungsi). Skrip diuji lokal termasuk 13 kontrol negatif (tiap penyimpangan → FAIL).
   c. `get_advisors` (security). d. Env Preview di atas + Redeploy. e. Uji manual: guru membuat & menerbitkan → siswa (kode akses) mengerjakan, ganti perangkat, submit → guru melihat hasil.

## Hambatan sisa
1. Migrasi belum ada di Workflow/staging cloud; belum ada validasi PostgREST/gateway Supabase nyata (kunci API, advisor). Butuh persetujuan; Supabase Free tanpa slot proyek/branch ketiga (org "Conan": 2 proyek = batas Free; branching = Pro).
2. (Terselesaikan) Ketergantungan pada `supabaseServer.ts` #60 sudah dihapus — modul mandiri.
3. Pembatasan laju & pagar jaringan belum ada (Vercel Firewall / App Check — tindakan manual); tiap autosave memanggil fungsi serverless.
4. Uji beban (±1300 siswa serentak) belum ada; E2E belum di CI.
5. Jalur lama #60 yang memakai secret key pada tabel lama (panel owner, rename kelas, backfill) kemungkinan gagal `permission denied` karena `service_role` tanpa grant di Workflow (belum diuji; di luar modul ini).
