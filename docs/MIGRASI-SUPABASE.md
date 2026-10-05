# Migrasi Firebase → Supabase — status & langkah

Target: proyek Supabase **Workflow** (`htutgpjcynbnyxwgorcb`, ap-northeast-1).
Aturan: data produksi Firestore tidak boleh hilang. Firestore tetap sumber
kebenaran sampai cutover; tidak ada langkah di bawah yang menulis/menghapus
di Firestore.

## Status

| Tahap | Status |
|---|---|
| Skema 21 tabel + RLS + Storage bucket `submission-attachments` | Selesai, tabel kosong |
| Audit RLS/grant/SECURITY DEFINER vs `firestore.rules` | Selesai (lihat bawah) |
| Skrip salin data (`scripts/migrate-firestore-to-supabase.mjs`) | Siap, teruji pada fixture |
| Dry-run terhadap data Firestore asli | **Menunggu Anda** (langkah 3) |
| Porting kode app (adapter → Supabase) | Belum — mulai setelah dry-run bersih |
| Cutover | Belum |

## Temuan audit & perbaikan (migrasi DB sudah diterapkan)

1. **Semua query role `authenticated` gagal** (`permission denied for function
   is_teacher_workspace`): helper RLS di schema `private` tidak punya GRANT.
   → GRANT USAGE schema + EXECUTE helper ke `authenticated`.
2. **Policy memakai `auth.uid()` (cast uuid)** — UID Firebase bukan uuid,
   semua policy akan error. → `private.current_uid()` dari klaim JWT `sub`
   (text), dipakai di seluruh policy & helper.
3. Regex link Google Drive di policy `submissions` salah (`\\.`) → semua link
   asli ditolak. Diperbaiki.
4. Kode undangan bisa dienumerasi semua user login (`workspace_invites_get`
   = true, `workspaces_invite_preview`). Ditutup; join lewat RPC
   `lookup_workspace_invite(code)`.
5. `student_notes` terbaca semua guru & tanpa UPDATE. → hanya wali kelas
   (+ admin/owner untuk baca).
6. `class_fund_transactions`, `class_inventory`, `student_achievements`:
   tulis hanya wali kelas (paritas `firestore.rules`).
7. `teacher_profiles`: guru bisa mengangkat diri jadi wali kelas kelas mana
   pun; alur join pertama (workspace null → id) terblokir. → trigger guard
   (`private.guard_teacher_profile_update`) + `private.can_claim_role`.
8. `submissions`: siswa bisa menimpa `feedback`/`score`, dan tidak ada kunci
   setelah dinilai (paritas fix "siswa terkunci setelah guru mengisi nilai").
   → trigger `private.guard_student_submission_update`.
9. Tabel `academic_years` belum ada → ditambah (+ RLS).
10. `updated_at` ditimpa trigger saat import → hanya `service_role` yang boleh
    mengisinya eksplisit; user biasa tetap dipaksa `now()`. `workspace_id` &
    `created_at` immutable (kecuali `service_role`).
11. `payments`: hak tulis `authenticated` dicabut (hanya server/webhook).
12. 5 fungsi RPC lama tak terpakai dicabut dari `authenticated`; 16 index FK
    ditambahkan.

Semua perilaku di atas diuji sebagai role `authenticated` sungguhan di dalam
transaksi yang di-rollback (tidak ada data tersisa).

### Sisa peringatan advisor (disengaja / di luar kendali SQL)
- `claim_student_login_code`, `lookup_workspace_invite`: SECURITY DEFINER
  yang memang dipanggil client (butuh kode rahasia).
- Leaked-password protection: tidak relevan selama login tetap lewat
  Firebase Auth.
- 2 index duplikat (`idx_submissions_student`, `idx_teacher_profiles_workspace`):
  hapus manual lewat SQL Editor (`drop index`), tool otomatis tidak bisa DROP.

### Paritas yang sengaja TIDAK diperketat (sama dengan Firestore hari ini)
- `student_profiles` bisa dibuat siapa pun untuk `student_id` apa pun
  (tidak diverifikasi ke kode login). Perbaikan: RPC `create_student_profile`
  saat porting.
- Siswa membaca presensi seluruh kelasnya.
- `workspaces` create tidak membatasi `plan`/limit.

## Langkah manual untuk Anda (satu per satu)

1. **Backup Firestore dulu.** GitHub → Actions → "Backup Firestore" →
   Run workflow. Tunggu hijau.
2. **Supabase → Authentication → Sign In / Providers → Third-Party Auth →
   Add provider → Firebase**, isi Project ID Firebase Anda. (User & UID tidak
   dimigrasi; login tetap Firebase.)
3. **Dry-run di komputer Anda** (aman, hanya baca):
   ```bash
   export FIREBASE_ADMIN_SERVICE_ACCOUNT='<isi JSON service account, satu baris>'
   node scripts/migrate-firestore-to-supabase.mjs
   ```
   Kirim ke saya HANYA tabel ringkasan + baris `NOT_NULL / FK_ORPHAN /
   DUPLICATE / UNPARSED_VALUE`. Jangan kirim key/JSON.
4. Setelah dry-run bersih (atau masalahnya sudah diputuskan), `--apply`
   butuh `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — set sebagai env di
   terminal Anda sendiri, jangan di chat.

## Rencana porting (setelah langkah 3 bersih)
1. Adapter `supabaseAdapter.ts` dengan antarmuka sama seperti
   `firestoreAdapter.ts`, dipilih lewat flag env (`NEXT_PUBLIC_DATA_BACKEND`).
2. Repository per koleksi, read-only dulu (dual-read + bandingkan).
3. Tulis ke kedua backend (dual-write) selama masa transisi.
4. Route Admin SDK (rename kelas, join, pembayaran) → Edge Function/route
   dengan service role.
5. Storage lampiran → bucket `submission-attachments`.
6. Cutover: jalankan ulang skrip `--apply` (menyusul delta), flip flag,
   Firestore tetap hidup (read-only) beberapa minggu sebagai cadangan.
