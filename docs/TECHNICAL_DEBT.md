# Technical Debt Register

## TD-001: Soft Delete Architecture

**Status:** Sebagian besar selesai — soft delete, pemulihan, Recycle Bin UI, dan hapus permanen manual; hapus terjadwal dan Audit Log belum.

**Yang sudah ada**
- `deletedAt` / `deletedBy` (+ `deletedBatchId` untuk hapus-kelas) pada `students`, `assignments`, `grade_columns`.
  Nilai di kolom yang dihapus ikut tersembunyi (tabel nilai dibangun dari kolom aktif) dan kembali saat kolom dipulihkan.
- "Hapus kelas" = soft delete semua siswanya, lewat `POST /api/classes/delete` (khusus OWNER/ADMIN);
  `POST /api/classes/restore` memulihkannya (menghormati batas kelas paket).
- Semua query repository menyaring dokumen terhapus di sisi aplikasi (`lib/utils/softDelete.ts`) —
  BUKAN `where('deletedAt','==',null)`, karena Firestore tidak mencocokkan dokumen yang field-nya tidak ada.
- Fungsi pemulihan tersedia di repository/service/controller (`restoreStudent`, `restoreAssignment`, `restoreColumn`, `restoreClass`).
- Peran (firestore.rules): hanya pembuat dokumen (`createdBy`) atau OWNER/ADMIN yang boleh soft delete / memulihkan /
  menghapus permanen. Hapus permanen `students`/`assignments`/`grade_columns`/`submissions`/`student_login_codes`/`academic_years`
  hanya OWNER/ADMIN. Dokumen lama tanpa `createdBy` hanya bisa dihapus OWNER/ADMIN.

**Recycle Bin (9 Nov 2026)**
- Halaman Akun › Sampah (`/account/sampah`): daftar item terhapus (kelas, siswa, tugas, kolom nilai), pulihkan, saring per jenis.
- Pemulihan siswa lewat server (`POST /api/students/restore`) karena bisa menghidupkan kelas dan harus lolos batas paket.
- **Hapus permanen manual** (khusus OWNER/ADMIN): `POST /api/trash/purge` — satu item atau "Kosongkan Sampah". Hanya item yang
  sudah di Sampah. Cascade: siswa → kode akses, sesi login, nilai, pengumpulan + lampiran, prestasi, catatan wali kelas;
  tugas → pengumpulan + lampiran + materi; kolom nilai → nilainya; kelas → siswa yang terhapus bersamanya. Anak dihapus dulu,
  induk terakhir (aman diulang bila terputus); lampiran fisik dihapus SEBELUM dokumen path-nya (gagal → dibatalkan, tidak yatim).
  Tidak tercakup: nama siswa yang tersalin di rekap presensi per pertemuan, data ujian Ulangan (Supabase), jurnal/presensi/jadwal kelas.

**Belum dikerjakan**
- Hapus permanen terjadwal (retensi 30 hari) — rencana: Cloud Function terjadwal yang memanggil logika `trashPurgeService`
  (sudah idempoten dan berbatas waktu) untuk item dengan `deletedAt` lebih lama dari 30 hari.
- Audit Log (siapa menghapus permanen apa) — saat ini hanya tercatat di log server (`trash.purged`).
- Jurnal, presensi, jadwal, pengumuman masih hard delete (dibatasi pembuat/OWNER/ADMIN, tidak bisa dipulihkan).
- Sel nilai yang dikosongkan masih dihapus permanen (hanya pembuat kolom / OWNER/ADMIN).

## Rename kelas

**Status:** Diperbaiki (8 Nov 2026) — crash-safe dan dapat dilanjutkan; BUKAN atomik lintas batch.

`renameClassServer` (`lib/server/classAdminService.ts`):
- tiap batch (maks 450 dokumen + 1 dokumen job < batas 500) ATOMIK; kelas kecil selesai dalam satu batch;
- Firestore tidak punya commit atomik di atas 500 operasi, jadi rename besar dipecah tetapi IDEMPOTEN dan
  DAPAT DILANJUTKAN: dokumen yang belum pindah masih bernama lama dan ditemukan lagi oleh pemanggilan berikutnya;
- progres (`renamedCount`) ditulis di batch yang sama dengan datanya (`class_rename_jobs/{workspaceId}`);
- satu rename per workspace dengan kunci sewa (lease); rename terputus harus diselesaikan dulu (panggil ulang nama yang sama);
- bila waktu permintaan habis, server melapor `done: false` dan klien memanggil ulang otomatis;
- pembuatan siswa ke kelas yang sedang diganti namanya ditolak (409).

Yang tetap tidak dijamin: pembacaan oleh pengguna lain di tengah rename besar bisa melihat kelas terbelah sementara;
penulisan langsung dari client (jurnal, presensi) ke nama lama saat rename berjalan bisa terlewat — ulangi rename atau
jalankan `scripts/check-class-rename-consistency.mjs`. Penyelesaian struktural tetap: ganti `className` terdenormalisasi
dengan referensi `classId` (perubahan skema + migrasi data, butuh persetujuan terpisah).
