# Backup & Ekspor Data (di dalam aplikasi)

Menu: **Akun → Backup & Ekspor Data** (`/account/backup`). Guru menekan **Unduh Backup** kapan saja dan mendapat satu berkas ZIP
(opsional terenkripsi) lewat mekanisme unduhan perangkat → bisa disimpan ke Files, iCloud Drive, atau Google Drive pribadi.
Tidak ada penyimpanan di server, tidak ada URL publik, dan tidak ada batas "sebulan sekali".

> Ini **bukan** backup otomatis ke Drive (PR `feat/backup-firestore-drive` terpisah). Fitur ini manual, dijalankan guru.

## Langkah untuk guru
1. Akun → **Backup & Ekspor Data**. Biarkan **Lindungi dengan kata sandi** aktif, isi kata sandi (min. 8 karakter) dua kali. **Catat kata sandinya**: tidak bisa dipulihkan.
2. **Unduh Backup**. Tunggu sampai muncul "Backup berhasil diunduh" (jangan tutup halaman). Periksa kotak **cakupan**: ia menyebut apa yang belum termasuk.
3. Pindahkan berkas `teacher-workspace-backup-….zip.enc` dari Unduhan/Files ke iCloud Drive atau Google Drive pribadi.
4. (Opsional) **Unduh Lampiran** untuk isi file foto/PDF jawaban siswa (beberapa ZIP kecil; ikuti izin unduhan banyak berkas).
5. Untuk membaca isinya: bagian **Buka Arsip Terenkripsi** di halaman yang sama (berjalan di perangkat Anda). Untuk memulihkan ke aplikasi/database lain: lihat "Pemulihan".

## Isi arsip
```
manifest.json            daftar isi, jumlah per koleksi, SHA-256 + ukuran tiap berkas, CAKUPAN (apa yang termasuk/tidak)   ← entri TERAKHIR
README.txt               penjelasan singkat
firestore/<koleksi>.ndjson   satu dokumen per baris {"p":"koleksi/id","d":{…}}; tipe Timestamp/GeoPoint/Reference/Bytes dijaga
attachments/index.ndjson daftar lampiran (referensi saja; tanpa URL bertoken)
ulangan/exams.json, ulangan/exam-<id>.json   Ulangan Harian (hanya bila fitur aktif di lingkungan itu)
```

## Cakupan (inventaris)
| Sumber | Status |
|---|---|
| **Firestore** — workspaces, teacher_profiles, students, schedules, journals, session_skip_reasons, academic_years, attendances, grades, grade_columns, assignments, announcements, submissions, class_fund_transactions, class_inventory, student_notes, student_achievements | **Diekspor**, hanya data workspace guru yang login, sesuai hak baca (di bawah) |
| **Ulangan Harian (Supabase)** | Diekspor sebagai JSON **bila fitur aktif** (lewat aksi guru yang sama dengan UI). Bila nonaktif/gagal: dicatat di manifest dan UI — **tidak** dianggap lengkap |
| **Lampiran pengumpulan tugas (Supabase Storage, bucket privat)** | Daftar di arsip data; **isi file** diunduh terpisah (bagian ≤30 file/≈40 MB) lewat "Unduh Lampiran" |
| Lampiran/materi lama di **Firebase Storage**, tautan Google Drive siswa | Hanya referensi di `attachments/index.ndjson`; **isi tidak diunduh** |
| Akun login (**Firebase Auth**) | **Tidak** termasuk |
| `payments`, `student_login_codes`, `student_profiles`, `workspace_invites` | **Sengaja tidak** (alasan di manifest) |
| Kode undangan guru di dokumen workspace | Dihapus dari arsip (rahasia) |

`coverage.overall` di manifest **selalu `sebagian`** selama ada hal di atas yang belum tercakup. Koleksi akar Firestore yang tidak dikenal inventaris
dicatat di `firestore.unrecognizedCollections` dan menurunkan `coverage.firestore` menjadi `sebagian`.

### Hak akses (dicerminkan dari `firestore.rules`, ditegakkan ulang di server karena Admin SDK melewati rules)
- Identitas: ID token Firebase diverifikasi **dengan cek pencabutan sesi**; peran/workspace dibaca dari Firestore (bukan dari body/klien). Guru nonaktif, OWNER yang tidak cocok `ownerUid`, workspace tidak ada → 403.
- Semua guru aktif: data workspace-nya sendiri. **Tidak ada ekspor lintas workspace** (tidak ada peran di aplikasi yang berwenang untuk itu; `workspaceId` dari klien diabaikan).
- Guru biasa: hanya profil sendiri; `student_notes`/`student_achievements` hanya bila **wali kelas** dan hanya kelasnya. OWNER/ADMIN: seluruh profil guru, catatan, dan prestasi workspace.
- Lampiran: path wajib `submissions/<workspaceId sendiri>/<tugas>/<uid>/<file>`; selain itu 400.

## Keamanan arsip
- **Tanpa penyimpanan di server**: ZIP dialirkan langsung ke browser (`Cache-Control: no-store, private`, `Content-Disposition: attachment`); tidak ada berkas sementara, tidak ada tautan unduh, token hanya di header `Authorization`.
- **Enkripsi (diimplementasikan)**: sisi klien, AES-256-GCM, kunci dari kata sandi lewat PBKDF2-SHA256 (600.000 iterasi, salt acak 16 B). Kata sandi **tidak dikirim ke server**. Hilang = tidak bisa dibuka.
- **Evaluasi alternatif**: enkripsi sisi server dengan kunci server → tidak berguna untuk unduhan pribadi (server memegang kunci; guru tak bisa membuka sendiri) dan menambah CPU serverless; password bawaan ZIP (ZipCrypto) → lemah; ZIP-AES → tidak dibuka natively di iOS Files; kunci publik/Keychain → butuh manajemen kunci perangkat yang rumit. Frasa sandi yang disimpan di pengelola kata sandi adalah mekanisme paling realistis untuk guru.
- Arsip berisi **data pribadi siswa dan kode akses siswa**. UI memperingatkan dan menyarankan enkripsi; mematikannya menampilkan peringatan merah.
- Pagar penyalahgunaan: satu ekspor per workspace per 5 menit (`BACKUP_COOLDOWN_SECONDS`), batas ±60.000 dokumen (`BACKUP_MAX_DOCS`). Tiap dokumen yang dibaca memakai kuota baca Firestore yang sama dengan aplikasi.
- Log server tidak memuat isi data/pesan galat mentah.

## Batas dan perilaku
- Respons streaming (tanpa batas 4,5 MB respons biasa); `maxDuration` 60 dtk; memori terbatas (ZIP ditulis per blok 256 KB, Firestore dibaca dengan `stream()`).
- Format ZIP tanpa ZIP64: maks. 4 GB / 65.535 entri (jauh di atas kebutuhan; dijaga dengan galat jelas).
- Hasil **bukan snapshot atomik** (dibaca per koleksi); hindari mengubah data saat unduhan.
- Koneksi putus di tengah unduhan: arsip tidak ditulis (manifest + direktori pusat ZIP ada di akhir), UI menyatakan unduhan terputus, slot cooldown dilepas agar bisa diulang.
- Data kosong tetap menghasilkan arsip sah dengan jumlah 0.

## Pemulihan (selalu ke lingkungan terpisah dulu)
```bash
# 1. Verifikasi saja (tidak menulis apa pun): CRC ZIP, SHA-256 tiap berkas, jumlah dokumen, cakupan
BACKUP_PASSPHRASE='…' node scripts/backup/restore-export.mjs arsip.zip.enc --project demo-restore
# 2. Pulihkan ke emulator Firestore lokal
npx firebase-tools emulators:start --only firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 BACKUP_PASSPHRASE='…' node scripts/backup/restore-export.mjs arsip.zip.enc --project demo-restore --apply
```
Ke Firestore nyata skrip menolak kecuali `--apply --confirm-project <id> --i-know-this-writes-real-data` dan `FIREBASE_SERVICE_ACCOUNT` project tujuan. Yang dipulihkan: **hanya data Firestore**. Ulangan Harian (JSON) dan isi lampiran **belum** punya pemulihan otomatis.

## Status bukti (12 Okt 2026)
| Dibuktikan | Cara |
|---|---|
| Otorisasi (401/403), isolasi workspace, hak per peran, manifest/cakupan, data kosong, kegagalan di tengah aliran, cooldown, batas ukuran | `tests/backup-export.test.ts` (Firestore Emulator, 28 tes) |
| Integritas arsip (CRC, SHA-256, dipalsukan/terpotong ditolak; ZIP valid menurut Python `zipfile`), enkripsi, restore ke proyek **terpisah** dengan isi identik per dokumen | idem |
| Sisi klien (galat → pesan guru, unduhan terputus, kata sandi tidak dikirim, loop lampiran, buka arsip) | `tests/backup-client.test.ts` |
| Alur browser nyata: menu → unduh terenkripsi/biasa → dekripsi → verifikasi → restore emulator; isolasi dua guru; jaringan putus; tanpa token | `npm run test:e2e:backup` |
| **Belum dibuktikan** | Firebase/Supabase **nyata** dengan akun asli; Ulangan Harian nyata dengan data; unduhan lampiran dari Supabase Storage nyata; perangkat fisik (iPad/iPhone Safari, Android); ukuran data produksi besar; waktu eksekusi di Vercel |
