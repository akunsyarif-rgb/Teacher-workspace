# Runbook: `session_skip_reasons` Firestore → Supabase (koleksi percobaan)

Status: kode siap, **belum dijalankan terhadap Supabase nyata**. Flag default mati (semua koleksi tetap Firestore).

## Prasyarat (semua wajib sebelum flag dinyalakan)
1. **Auth Firebase→Supabase terbukti** (project Workflow): Dashboard → Authentication → Sign In / Providers →
   Third-Party Auth → Add provider → Firebase → isi Firebase Project ID. Token Firebase harus membawa
   `role: "authenticated"` (custom claim; Supabase menolak token tanpa claim `role`). Uji: ambil ID token guru dan
   siswa anonim, `GET /rest/v1/session_skip_reasons` dengan `Authorization: Bearer <token>` → 200 (guru: hanya workspace sendiri).
2. **Staging Supabase** (bukan Workflow produksi, bukan SmadaExam) dengan migrasi `20261009000000_rls_hardening.sql` (PR #59) terpasang
   dan `tests/rls-parity.test.ts` hijau di staging.
3. Backup produksi sebelum migrasi ke produksi (dashboard Database → Backups, atau `pg_dump` skema+data).

## Urutan
0. Guard skrip: `--workspace` wajib; `SUPABASE_ALLOWED_REFS` wajib memuat ref target (kosong = tolak semua); SmadaExam selalu ditolak;
   project Workflow produksi juga butuh `ALLOW_PRODUCTION_BACKFILL=yes`. Exit code: 0 bersih, 1 gagal parsial/rekonsiliasi kotor, 2 konfigurasi ditolak.
   Dry-run hanya melakukan GET (diuji). Backfill tidak pernah menghapus baris berlebih di Supabase; hanya melaporkannya.
1. Staging: `backfill-skip-reasons.ts --workspace <ws uji>` (dry-run) → `--apply` → ulangi dry-run; harus `ok: true`.
2. Nyalakan `NEXT_PUBLIC_SUPABASE_COLLECTIONS=session_skip_reasons` hanya di Preview staging; uji alur Beranda "Perlu Konfirmasi".
3. Produksi (butuh persetujuan eksplisit): backfill satu workspace → rekonsiliasi bersih → flag → pantau.
4. Tidak ada dual-write: selama flag aktif, Supabase sumber kebenaran koleksi ini; tulisan baru tidak masuk Firestore.

## Rollback
- Matikan flag → klien kembali ke Firestore. Data yang ditulis **saat flag aktif** hanya ada di Supabase:
  sebelum rollback, ekspor selisih (rekonsiliasi dibalik) dan tulis ulang ke Firestore bila perlu. Karena koleksi ini hanya
  catatan alasan harian, kehilangan data bersifat rendah dampak, tetapi tetap dicatat.
- Backfill idempoten (upsert per id) dan hanya menambah/menimpa baris Supabase; Firestore tidak diubah.

## Pemetaan
Kolom: `workspaceId→workspace_id`, `className→class_name`, `teacherUid→teacher_uid`, `date`, `reason`.
Sisanya (`scheduleId`, `note`, …) di `metadata` jsonb. Catatan: pencarian per `scheduleId` memakai `metadata->>scheduleId`
tanpa indeks; bila volume besar, tambahkan kolom `schedule_id` + indeks lewat migrasi terpisah.

## Batas yang diketahui
- `updateDocument` baca-lalu-PATCH (tidak atomik); aman di sini karena satu dokumen per (scheduleId, date) ditulis satu guru sekali.
- Offline: Firestore menyimpan antrean tulis offline; adapter Supabase tidak. Koleksi ini akan gagal menyimpan saat offline bila flag aktif.
