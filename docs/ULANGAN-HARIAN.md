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
- **Env server:** `NEXT_PUBLIC_ULANGAN_ENABLED=yes` (default mati; juga dibaca server), `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FIREBASE_ADMIN_SERVICE_ACCOUNT`. Target SmadaExam ditolak oleh `serviceRequest`.
- **Dependensi PR:** modul memakai `lib/server/supabaseServer.ts` (PR #60). Migrasinya **mandiri** (tidak memerlukan SQL PR #59).

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
- `ulangan-server` (11): identitas dari Firestore, aktor tak bisa dipalsukan, kelas harus ada, pemetaan galat, rekap.
- `ulangan-client` (7), `workspace-server-supabase`, `rls-parity`, `rls-migration`.
- **E2E browser** `npm run test:e2e:ulangan` (22 langkah): guru membuat & menerbitkan, siswa mengerjakan (peringatan integritas, autosave, reload, pindah perangkat, submit), guru melihat hasil. Gateway lokal menggantikan gateway Supabase (hanya untuk server). Belum di CI.
- CI: `.github/workflows/ulangan-db-tests.yml` (push ke branch ini / PR / manual): Postgres + PostgREST di runner, tanpa secret.
- Jalankan lokal: `POSTGREST_BIN=... RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-*.test.ts`

## Penerapan (hanya setelah persetujuan eksplisit; tidak dilakukan)
1. Terapkan `supabase/migrations/20261010000000_ulangan_harian.sql` ke staging/Workflow (aditif murni; rollback `supabase/rollback/…_down.sql` menghapus semua data ulangan). Jalankan `get_advisors`.
2. Env Preview (Vercel): `NEXT_PUBLIC_ULANGAN_ENABLED=yes`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FIREBASE_ADMIN_SERVICE_ACCOUNT`; Redeploy.
3. Uji dengan akun guru + siswa uji: buat → terbitkan → kerjakan → hasil.

## Hambatan sisa
1. Migrasi belum ada di Workflow/staging cloud; belum ada validasi PostgREST/gateway Supabase nyata (kunci API, advisor).
2. PR #60 (`supabaseServer.ts`) harus masuk dulu (atau modul ini digabung bersamanya).
3. Pembatasan laju & pagar jaringan belum ada (Vercel Firewall / App Check — tindakan manual); tiap autosave memanggil fungsi serverless.
4. Uji beban (±1300 siswa serentak) belum ada; E2E belum di CI.
5. Jalur lama #60 yang memakai secret key pada tabel lama (panel owner, rename kelas, backfill) kemungkinan gagal `permission denied` karena `service_role` tanpa grant di Workflow (belum diuji; di luar modul ini).
