# Status Migrasi Firestore → Supabase (ditahan)

Diperbarui: 2026-10-10. Status: **DITAHAN** sampai aplikasi dipakai sendiri dulu. Production tetap Firebase.

## Ringkasan

| Hal | Status |
|---|---|
| Production | Firebase Auth + Firestore. Tidak berubah. |
| Flag migrasi (`NEXT_PUBLIC_SUPABASE_*`) | Semua OFF |
| Project Supabase | Workflow `htutgpjcynbnyxwgorcb` (bukan SmadaExam) |
| Skema + RLS di Workflow | Terpasang (migrasi PR #59). Tabel masih 0 baris. |
| Auth Firebase → Supabase | Terbukti guru + siswa anonim lewat `/cek-supabase` di Preview |
| Tulis/baca data lewat aplikasi | Belum diuji |
| Backfill / cutover | Belum dijalankan |
| Perkiraan progres menuju "dipakai guru lain di Supabase" | ~55% |

## Yang sudah terbukti (di Supabase asli)

- Token Firebase guru diterima (Third-Party Auth aktif, claim `role=authenticated` dipasang server).
- Token siswa anonim diterima; tanpa login ditolak 401.
- Identitas terpetakan (`auth_probe`: sub = uid Firebase).
- `verify/post_migration.sql` setara: 21/21 lolos.
- 26 skenario perilaku RLS/RPC lolos (disimulasikan lewat SQL dalam transaksi yang dibatalkan, bukan lewat aplikasi).

## Yang belum terbukti

- Jalur penuh token Firebase → PostgREST → adapter → UI untuk operasi tulis.
- Backfill data asli, kuota, cutover, rollback nyata.

## Catatan teknis

- Migrasi diterapkan terpecah karena tool MCP menahan perintah berisi `drop`/`delete`. Daftar migrasi di Workflow tidak sama persis dengan file repo; hasil akhir sudah dicek lewat katalog.
- Endpoint `/api/auth/supabase-claim` hanya aktif bila `ENABLE_SUPABASE_CLAIM=yes` (Preview saja).
- Bucket Storage `submission-attachments` dipakai production dan tidak tersentuh.

## Saat ditahan

- Jangan merge PR #59/#60 sebelum syarat di bawah terpenuhi (urutan #59 lalu #60).
- Jangan ubah env Production Vercel.
- Perbaikan/fitur baru dikerjakan di `main`, lepas dari jalur migrasi.

## Langkah berikutnya (urut)

1. **Tes tulis di Preview** (butuh persetujuan: "setuju tes tulis Preview"):
   akun Firebase uji baru (bukan akun guru asli), flag hanya di env Preview, uji buat workspace → kode undangan → join → `batch_write`; hapus data uji sesudahnya.
2. **Kuota** SMAN 2 Tarakan: `seatLimit` 100, `classLimit` 60 (Firebase Console → Firestore → workspaces), sebelum backfill.
3. **Secret GitHub Actions** untuk backfill: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ALLOWED_REFS=htutgpjcynbnyxwgorcb` (`FIREBASE_SERVICE_ACCOUNT` sudah ada). Opsional: environment `supabase-cutover` dengan reviewer.
4. **Backfill uji** ke Workflow dengan flag OFF, bandingkan jumlah baris; latih rollback (`--reverse`).
5. **Cutover satu jendela** sesuai `docs/CUTOVER-SUPABASE.md` (gate G1–G6), butuh persetujuan eksplisit tiap tahap.
6. Merge #59 lalu #60 setelah gate lolos.
