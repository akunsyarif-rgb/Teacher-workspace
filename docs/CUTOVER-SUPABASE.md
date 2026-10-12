# Cutover Firestore → Supabase (SMAN 2 Tarakan) — runbook

Status kode: selesai + tes lokal lulus. **Belum terverifikasi terhadap Supabase nyata. Belum ada yang aktif.** Semua langkah yang menyentuh produksi butuh persetujuan eksplisit pemilik (ditandai ⛔).

## 0. Temuan yang menentukan bentuk cutover: SATU JENDELA, bukan koleksi demi koleksi
`firestore.rules` membaca `teacher_profiles` dan `workspaces` **di Firestore** untuk mengizinkan akses ke koleksi data. Jika identitas pindah ke Supabase sementara sebagian data masih di Firestore,
profil Firestore menjadi basi: guru yang baru bergabung / dikeluarkan / berganti peran tidak tercermin, dan aksesnya ke koleksi Firestore itu rusak. Tanpa dual-write (dilarang) tidak ada jembatan.
Karena itu kode menegakkan aturan **all-in di produksi** (`lib/config/dataBackend.ts`, teruji): tanpa `NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE=yes`, Supabase hanya menyala bila **semua 19 koleksi** dicantumkan **dan** auth guru + auth siswa terverifikasi. Satu sekolah = satu jendela cutover pendek.
Bertahap hanya di tingkat: (a) validasi di Preview, (b) backfill (boleh berulang kali sebelum jendela), (c) tahap pemeriksaan.

String flag lengkap (19 koleksi):
```
session_skip_reasons,academic_years,class_fund_transactions,class_inventory,student_notes,schedules,grade_columns,grades,student_achievements,journals,attendances,announcements,assignments,submissions,students,student_login_codes,student_profiles,workspaces,teacher_profiles
```

## 1. Gerbang sebelum menyentuh produksi (semua harus ✅)
| # | Gerbang | Cara membuktikan |
|---|---|---|
| G1 | Third-Party Auth Firebase aktif di Workflow | halaman `/cek-supabase` di Preview: baris "Supabase menerima token" ✅ untuk **guru** dan **siswa anonim** |
| G2 | Claim `role` terpasang (endpoint `/api/auth/supabase-claim`, `ENABLE_SUPABASE_CLAIM=yes`) | baris "Claim role" ✅ |
| G3 | Migrasi #59 (`…0000` s/d `…0300`) terpasang di Workflow | `scripts/supabase/staging.sh verify migrated` (atau saya jalankan via MCP setelah disetujui) → semua PASS; `/cek-supabase` baris "Identitas terpetakan" ✅ |
| G4 | Uji menyeluruh di **Preview dengan flag Preview-only** memakai akun uji (bukan akun guru asli) | alur: daftar guru uji → buat workspace → tambah kelas/siswa → login siswa dengan kode → presensi/jurnal/nilai → keluar-masuk offline |
| G5 | Kuota SMAN 2 Tarakan sudah diatur (lihat PANDUAN-IPAD M3) | nilai tampil benar di Firestore **sebelum** backfill (nilai ikut tersalin) |
| G6 | Backfill dry-run bersih-berurutan (laporan jumlah) | GitHub Actions "Supabase backfill / rollback data" mode `dry-run`, tahap `all` |

## 2. Urutan jendela cutover ⛔ (perlu persetujuan eksplisit; ± 20–30 menit di luar jam mengajar)
1. **T-1 hari:** umumkan ke guru "jangan input data 20 menit pada jam X". Pastikan G1–G6.
2. **Backfill awal (aplikasi masih normal di Firestore):** Actions → mode `apply`, konfirmasi `TERAPKAN`, `izin_produksi=ya`, `workspace_id` = ID workspace sekolah, tahap berurutan `identity` → `teacher` → `school` → `students` → `submissions` (atau `all`). Skrip berhenti di tahap pertama yang tidak bersih. Aman diulang.
3. **Jendela:** (a) mulai pembekuan input; (b) jalankan `apply` **sekali lagi** untuk `all` (delta idempoten) → laporan harus **BERSIH** untuk semua koleksi (jumlah Firestore = Supabase, hilang/berlebih/beda/duplikat = 0);
   (c) Vercel → Production env: isi `NEXT_PUBLIC_SUPABASE_COLLECTIONS` (string di atas), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_TEACHER_AUTH_VERIFIED=yes`, `NEXT_PUBLIC_SUPABASE_STUDENT_AUTH_VERIFIED=yes`, `ENABLE_SUPABASE_CLAIM=yes` → **Redeploy** Production;
   (d) buka `/cek-supabase` sebagai guru dan di tab privat sebagai siswa → semua ✅; (e) smoke manual: login guru, daftar kelas/siswa muncul, simpan presensi, login siswa dengan kode, lihat tugas; (f) cabut pembekuan.
4. **Pantau 1–3 hari:** Vercel → Logs (error 401/403/5xx dari `/api/*` dan klien), Supabase → Logs → API; keluhan guru. Firestore **tidak diubah/dihapus** selama masa ini (jaring pengaman rollback).

## 3. Rollback
**Kapan rollback (salah satu):** `/cek-supabase` gagal setelah deploy; guru/siswa tidak bisa login/membaca data; error 401/403 massal; data tampak hilang/salah; rekonsiliasi pasca-cutover menunjukkan selisih yang tak bisa dijelaskan.
1. **Matikan flag:** Vercel Production → hapus `NEXT_PUBLIC_SUPABASE_COLLECTIONS` (atau kosongkan) → Redeploy (± 2–3 menit). Aplikasi kembali membaca Firestore seluruhnya.
2. **Selamatkan tulisan yang terjadi selama masa Supabase** (agar tidak hilang): Actions → mode `reverse-dry-run` (laporan "perlu disalin ke Firestore") → bila wajar `reverse-apply` + `TERAPKAN`. Menyalin (merge) Supabase → Firestore; **tidak pernah menghapus**; urutan tahap dibalik otomatis.
3. Verifikasi: guru login, data terakhir ada; jalankan `dry-run` lagi untuk melihat selisih.
4. Supabase dibiarkan apa adanya untuk analisis (tidak dihapus otomatis). Perbaiki penyebab, ulangi dari gerbang G4.
Batas rollback: tulisan yang dilakukan di perangkat offline dan belum terkirim (outbox IndexedDB) tersimpan di perangkat itu sampai online; setelah flag dimatikan outbox Supabase tidak terkirim otomatis — minta guru online sekali sebelum rollback bila memungkinkan.

## 4. Pemeriksaan pasca-cutover (jumlah data, relasi, izin)
- **Jumlah:** tabel laporan backfill (kolom firestore vs supabase) + Supabase Dashboard → Table Editor → hitung baris per tabel.
- **Relasi (SQL Editor, hanya baca):**
  ```sql
  select 'students tanpa workspace' k, count(*) from public.students s left join public.workspaces w on w.id=s.workspace_id where w.id is null
  union all select 'kode login tanpa siswa', count(*) from public.student_login_codes c left join public.students s on s.id=c.student_id where s.id is null
  union all select 'profil siswa tanpa siswa', count(*) from public.student_profiles p left join public.students s on s.id=p.student_id where s.id is null
  union all select 'guru dengan workspace tak ada', count(*) from public.teacher_profiles t left join public.workspaces w on w.id=t.workspace_id where t.workspace_id is not null and w.id is null
  union all select 'pemilik workspace tanpa profil OWNER', count(*) from public.workspaces w left join public.teacher_profiles t on t.user_id=w.owner_uid and t.workspace_id=w.id where t.user_id is null;
  ```
  Semua harus 0.
- **Izin:** `/cek-supabase` sebagai guru (✅), siswa anonim (✅); akun guru lain sekolah (non-anggota) tidak melihat data (RLS teruji lokal; pastikan juga di Preview dengan akun uji kedua).
- **Keamanan:** Supabase → Advisors (Security) tanpa temuan baru; `payments` tak tersentuh; `anon` tanpa hak tabel (`staging.sh verify migrated` mencakup ini).

## 5. Yang memerlukan persetujuan eksplisit pemilik (⛔)
1. Menerapkan migrasi #59 ke **Workflow** (tabel kosong: 0 baris per 10 Okt 2026; hanya fungsi/policy/grant yang berubah — tabel, kolom, trigger, Storage tidak disentuh; skema publik live identik dengan baseline berdasarkan sidik jari katalog; rollback teruji). Bisa saya lakukan lewat alat Supabase begitu Anda setuju.
2. Menulis data uji ke Workflow selama G4 (baris uji dihapus setelahnya).
3. Mengisi env Production dan Redeploy (jendela cutover).
4. Menjalankan backfill `apply` dengan `izin_produksi=ya`.
5. Merge PR #59 lalu #60 (urutan ini; keduanya tidak mengubah perilaku selama flag kosong, kecuali pesan kuota yang kini netral dan endpoint claim yang default mati).
