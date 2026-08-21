# Technical Debt Register

## TD-001: Soft Delete Architecture

**Status:** Deferred

**Reason:** Belum ada kebutuhan bisnis. Saat ini masih satu pengguna dan data uji.

**Estimated Impact:** High

**Affected Modules:**
- Student
- Attendance
- Journal
- Score
- Schedule
- Report

**Trigger:** Aktif ketika aplikasi memiliki pengguna eksternal pertama.

**Plan:** Satu sprint khusus (Sprint X) sebelum public release untuk:
1. Tambah field `deletedAt` / `isDeleted`
2. Ubah Repository (filter aktif)
3. Ubah Service (restore)
4. Tambah Recycle Bin UI
5. Audit Log

## Rename kelas: partial write antar-batch

Firestore membatasi 500 operasi per batch, jadi `renameClassServer` memecah
commit-nya. Pecahan itu tidak atomik satu sama lain: kalau batch ke-N gagal,
dokumen di batch sebelumnya sudah memakai nama baru sementara sisanya belum.

Yang SUDAH ada sekarang (perlindungan minimal, bukan penyelesaian):
- kegagalan batch dilempar dengan menyebut berapa dokumen yang terlanjur
  berubah — tidak pernah dilaporkan sebagai sukses
  (`lib/server/classAdminService.ts`, diuji di `tests/rename-partial-write.test.ts`)
- sisi klien menerjemahkan respons non-JSON/5xx jadi pesan yang menyuruh
  MEMERIKSA dulu, bukan mengulang (`lib/controllers/classController.ts`)
- `scripts/check-class-rename-consistency.mjs` — read-only, memeriksa apakah
  sebuah kelas terbelah antara nama lama dan nama baru di 16 koleksi

Yang BELUM dikerjakan, sengaja ditunda:
- Kalau function dimatikan platform (timeout/OOM), tidak ada kode yang sempat
  berjalan, sehingga deteksinya hanya lewat skrip di atas.
- Penyelesaian sebenarnya adalah berhenti menyimpan `className` terdenormalisasi
  di 16 koleksi dan beralih ke referensi `classId`, sehingga rename cukup
  menyentuh satu dokumen dan partial write mustahil terjadi. Ini perubahan
  schema + migrasi data, terlalu besar untuk digabung dengan perbaikan bug.
- Alternatif lebih ringan: antrean/background job supaya rename besar tidak
  terikat batas waktu satu request.
