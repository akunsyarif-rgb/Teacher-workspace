# Backup Firestore ke Google Drive pribadi (tanpa billing)

## Status jujur (12 Okt 2026)

| Hal | Status |
|---|---|
| Backup otomatis lama (`backup-firestore.yml`, `gcloud firestore export` → bucket GCS) | **Tidak pernah berhasil** (gagal tiap malam sejak ≥3 Okt: secret `FIRESTORE_BACKUP_BUCKET` kosong). Jalur ini juga membutuhkan **Blaze (billing)** untuk Managed Export + bucket. Tidak ada backup yang bisa dipulihkan dari jalur ini. |
| Backup ke Drive (dokumen ini) | **Kode + tes lokal selesai. BELUM berjalan di produksi.** Butuh langkah setup pemilik (di bawah). |
| Terbukti (tes otomatis, `tests/backup-restore.test.ts`, Firestore Emulator + server Drive palsu) | export → enkripsi → buka → restore ke proyek **terpisah** → sidik jari isi identik; tipe data terjaga; kunci salah / berkas diubah / terpotong ditolak; restore ke Firestore nyata ditolak tanpa konfirmasi; unggahan diverifikasi MD5; retensi; secret tidak bocor ke log. |
| **Belum terbukti** | Unggah ke Google Drive **nyata**; izin baca service account di Firestore nyata; run GitHub Actions nyata; restore dari berkas yang benar-benar diambil dari Drive nyata. Hingga ada satu run manual sukses + satu uji restore dari berkas itu, **jangan menyebut backup siap**. |

## Arsitektur

```
GitHub Actions (jadwal / manual)
  └─ scripts/backup/backup-to-drive.mjs
       1. Admin SDK membaca SEMUA koleksi akar (listCollections), satu readTime (snapshot konsisten lintas koleksi)
       2. NDJSON bertipe (Timestamp/GeoPoint/Reference/Bytes dijaga) + manifest (jumlah per koleksi + SHA-256)
       3. gzip + AES-256-GCM (kunci dari BACKUP_ENCRYPTION_KEY via scrypt) → berkas .twb
       4. Verifikasi lokal: berkas dibuka lagi & manifest dicek SEBELUM diunggah
       5. Drive API (OAuth refresh token, scope drive.file) → folder "TeacherWorkspace-Backups"; cek ukuran + MD5 di Drive
       6. Retensi: 14 harian + 8 mingguan + 6 bulanan; nama berkas asing tidak pernah dihapus
```

Mengapa bukan opsi lain:
- **GCS Managed Export**: butuh billing → ditolak.
- **Service account → Drive pribadi**: service account tidak punya kuota Drive; unggah ke My Drive ditolak (`storageQuotaExceeded`). Maka dipakai **OAuth milik Anda** dengan scope sempit `drive.file` (hanya berkas yang dibuat aplikasi ini, tidak bisa melihat/menghapus berkas Drive lain).
- **Google Drive sebagai database runtime / pengganti Firebase Storage**: di luar lingkup (Drive hanya tujuan arsip).

## Biaya dan batas

- **Biaya uang: Rp0.** Google Cloud project untuk OAuth client tidak butuh billing; Drive memakai kuota 15 GB akun Anda; GitHub Actions memakai menit gratis.
- **Kuota baca Firestore**: tiap dokumen yang dibackup = 1 baca, dari kuota harian yang **sama** dengan aplikasi (Spark: 50.000/hari). Skrip menghitung dulu (`count()`) dan **membatalkan** bila > `BACKUP_MAX_DOCS` (default 20.000; atur lewat repo variable) agar backup tidak menghabiskan kuota aplikasi.
- Snapshot memakai `readTime = sekarang − 5 dtk` (data yang ditulis dalam 5 dtk terakhir tidak ikut). Bila server menolak readTime, manifest mencatat `consistent: false` dan log memberi peringatan.
- Angka bilangan bulat > 2^53 kehilangan presisi (batas JS Admin SDK); tidak dipakai aplikasi ini.
- Berkas dibuat/dienkripsi **di memori**: cocok untuk data sekolah (≤ puluhan MB). Jauh lebih besar → perlu streaming (belum dibuat).
- **Tidak termasuk**: akun Firebase Auth (login email guru, akun anonim siswa), file Supabase Storage (lampiran tugas), data Supabase (Ulangan Harian), `storage.rules`/`firestore.rules` (ada di Git). Perlu backup terpisah bila dibutuhkan (mis. `firebase auth:export`, gratis).
- Backup kosong (0 dokumen) **ditolak** (indikasi salah project/izin) kecuali `BACKUP_ALLOW_EMPTY=yes`.

## Setup (sekali, oleh pemilik)

1. **OAuth client** (tanpa billing): console.cloud.google.com → buat/ pilih project → *APIs & Services* → aktifkan **Google Drive API** → *OAuth consent screen* (External) → **Publish app ke "In production"** (scope `drive.file` tidak sensitif, tidak perlu verifikasi; bila dibiarkan *Testing*, refresh token **kedaluwarsa 7 hari**) → *Credentials* → *OAuth client ID* jenis **Desktop app**.
2. Di komputer Anda: `DRIVE_CLIENT_ID=… DRIVE_CLIENT_SECRET=… node scripts/backup/get-drive-refresh-token.mjs`, buka URL yang dicetak, setujui. Salin `DRIVE_REFRESH_TOKEN` yang tercetak (jangan ditempel ke chat/commit).
3. GitHub → Settings → Secrets and variables → Actions → **Secrets**: `DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`, `DRIVE_REFRESH_TOKEN`, `BACKUP_ENCRYPTION_KEY` (frasa acak ≥ 16 karakter; **simpan juga di password manager — kunci hilang = backup tidak bisa dibuka**). `FIREBASE_SERVICE_ACCOUNT` dan `FIREBASE_PROJECT_ID` sudah ada; service account itu butuh peran baca Firestore (mis. *Cloud Datastore Viewer*). Disarankan membuat service account khusus baca-saja.
4. Uji manual: Actions → **Backup Firestore ke Google Drive** → *Run workflow*. Periksa ringkasan run (jumlah dokumen per koleksi) dan folder Drive.
5. **Wajib sebelum menyebut siap: uji restore** dari berkas hasil run itu (di bawah).
6. Aktifkan jadwal: repo **Variables** → `BACKUP_DRIVE_ENABLED` = `yes`. (Opsional) matikan jadwal workflow lama `backup-firestore.yml` yang tidak bisa berjalan tanpa billing.

## Restore (selalu uji dulu di tempat terpisah)

1. Unduh berkas `twbackup-….twb` dari folder Drive.
2. **Dry-run** (membuka + memverifikasi hash/manifest, tidak menulis apa pun):
   `BACKUP_ENCRYPTION_KEY=… node scripts/backup/restore-from-backup.mjs twbackup-….twb --project <id-tujuan>`
3. **Uji restore ke tempat terpisah** — emulator lokal atau project Firebase baru yang kosong (Spark, gratis):
   - Emulator: `npx firebase-tools emulators:start --only firestore` lalu `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 BACKUP_ENCRYPTION_KEY=… node scripts/backup/restore-from-backup.mjs <berkas> --project demo-restore --apply`
   - Project nyata terpisah: tambahkan `FIREBASE_SERVICE_ACCOUNT` milik project itu dan `--apply --confirm-project <id-tujuan>`.
4. Bandingkan jumlah dokumen per koleksi dengan manifest (dicetak otomatis) dan periksa beberapa dokumen.
5. Pemulihan ke project produksi (bencana saja): skrip menolak kecuali `--apply --confirm-project <id> --allow-overwrite-source-project`. Ini **menimpa** dokumen berpath sama; tidak menghapus dokumen lain. Lakukan hanya setelah langkah 3 sukses dan atas persetujuan pemilik.

## Pemeliharaan

- Perhatikan ringkasan run harian. Run gagal = tidak ada backup hari itu (GitHub mengirim email kegagalan workflow).
- Refresh token dapat dicabut (ganti password, cabut akses): jalankan ulang langkah 2 dan perbarui secret.
- Uji restore berkala (mis. tiap bulan) — backup yang tidak pernah dipulihkan belum terbukti.
