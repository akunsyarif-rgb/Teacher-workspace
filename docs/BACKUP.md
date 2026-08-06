# Backup & Restore Firestore

Backup Firestore berjalan otomatis setiap hari lewat GitHub Actions
(`.github/workflows/backup-firestore.yml`), pakai fitur bawaan Google Cloud
**Firestore Managed Export** — bukan sekadar salinan JSON, tapi format yang
bisa di-restore utuh (termasuk semua koleksi & dokumen) lewat satu perintah.

## Setup sekali di awal

Butuh 3 langkah manual di Google Cloud / Firebase Console (sekali saja,
tidak perlu diulang):

### 1. Buat bucket Cloud Storage khusus backup

Sengaja terpisah dari bucket Storage yang dipakai aplikasi (yang menyimpan
file upload pengguna), supaya izin aksesnya independen dan tidak tercampur.

1. Buka [Google Cloud Console → Cloud Storage](https://console.cloud.google.com/storage/browser)
   → pastikan project yang aktif adalah project Firebase Teacher Workspace
2. **Create bucket** → nama bebas tapi harus unik secara global, mis.
   `teacher-workspace-firestore-backups-<angka acak>`
3. Region: samakan dengan region Firestore-mu (biasanya `asia-southeast2`
   kalau Firestore-nya di Jakarta, atau cek di Firebase Console → Firestore
   → lihat lokasi database)
4. Storage class: **Standard** juga cukup untuk ukuran data sekolah
5. Access control: **Uniform**, dan biarkan **Public access: Prevented**
   (backup tidak boleh bisa diakses publik)

### 2. Atur lifecycle rule (auto-hapus backup lama)

Supaya biaya penyimpanan tidak terus bertambah tanpa batas:

1. Di bucket yang baru dibuat → tab **Lifecycle** → **Add a rule**
2. Action: **Delete**
3. Condition: **Age** → `30` hari (atau sesuai kebutuhan — 30 hari cukup
   untuk kebutuhan sekolah biasa)

### 3. Beri izin service account untuk export & tulis ke bucket

Service account yang sama dengan yang sudah dibuat untuk deploy Firestore
rules (`FIREBASE_SERVICE_ACCOUNT`) dipakai ulang di sini — tinggal
ditambah 2 role:

1. [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/iam)
   → cari service account yang emailnya ada di file JSON yang sudah kamu
   unduh sebelumnya (biasanya berbentuk
   `nama@project-id.iam.gserviceaccount.com`)
2. Klik ✏️ (edit) di baris service account itu → **Add another role**
3. Tambahkan:
   - **Cloud Datastore Import Export Admin** (untuk menjalankan export)
   - **Storage Object Admin** (untuk menulis hasil export ke bucket) —
     bisa dibatasi hanya ke bucket backup tadi lewat tab Permissions
     bucket itu sendiri kalau mau lebih ketat, bukan lewat IAM project
     secara keseluruhan

### 4. Tambah 1 GitHub secret baru

Repo → **Settings → Secrets and variables → Actions → New repository
secret**:

- `FIRESTORE_BACKUP_BUCKET` — nama bucket dari langkah 1 (cuma
  namanya, tanpa `gs://`)

(`FIREBASE_SERVICE_ACCOUNT` dan `FIREBASE_PROJECT_ID` sudah ada dari
setup deploy rules sebelumnya — dipakai ulang di sini.)

Setelah itu backup akan jalan otomatis tiap hari jam 22:00 WITA. Bisa juga
dites langsung lewat tab **Actions** di GitHub → pilih workflow **Backup
Firestore** → **Run workflow** (manual trigger, tidak perlu tunggu jadwal).

## Cara restore kalau data hilang/rusak

⚠️ Import akan **menimpa** dokumen yang path-nya sama di database tujuan.
Kalau restore ke database yang masih ada data lain (bukan database
kosong), pertimbangkan buat database Firestore baru dulu untuk verifikasi
sebelum menimpa data production.

1. Lihat daftar backup yang tersedia:
   ```
   gsutil ls gs://<nama-bucket>/firestore-backups/
   ```
2. Pilih timestamp yang mau dipulihkan, lalu jalankan:
   ```
   gcloud firestore import gs://<nama-bucket>/firestore-backups/<timestamp> \
     --project=<project-id>
   ```
3. Untuk restore sebagian (misal cuma koleksi `students` yang rusak, bukan
   semua), tambahkan `--collection-ids=students`:
   ```
   gcloud firestore import gs://<nama-bucket>/firestore-backups/<timestamp> \
     --project=<project-id> \
     --collection-ids=students
   ```

Perintah ini butuh `gcloud` CLI ter-install dan sudah login
(`gcloud auth login`) dengan akun yang punya akses ke project ini — bisa
dijalankan dari komputer mana saja, tidak harus dari CI.
