# Mengaktifkan Firebase Storage

Panduan langkah-demi-langkah untuk mengaktifkan Firebase Storage di project ini.
Ini satu-satunya cara upload lampiran tugas siswa bisa berfungsi — tanpa
bucket Storage, deploy `storage.rules` akan gagal dan fitur unggah lampiran
mati sama sekali walau kodenya sudah siap (lihat `storage.rules`).

Perkiraan waktu: 5 menit.

---

## 0. Yang perlu disiapkan dulu: paket Blaze (pay-as-you-go)

Sejak Oktober 2024, Firebase **mewajibkan paket Blaze** untuk membuat bucket
Storage baru — paket gratis (Spark) tidak bisa lagi. Ini kebijakan Firebase,
bukan sesuatu yang bisa dihindari dari sisi kode.

Kabar baiknya: Blaze tetap punya **kuota gratis bulanan** yang sama besarnya
dengan Spark (5 GB penyimpanan, 1 GB/hari unduhan). Anda hanya ditagih kalau
pemakaian melewati kuota itu — untuk skala satu sekolah/workspace, kemungkinan
besar Anda tidak akan pernah ditagih sepeser pun. Blaze cuma mengubah
"batas keras" jadi "bayar kalau lewat".

**Cara upgrade (kalau belum Blaze):**

1. Buka [Firebase Console](https://console.firebase.google.com) → pilih
   project Teacher Workspace
2. Pojok kiri bawah, klik nama paket saat ini (biasanya tertulis **Spark**)
3. Klik **Upgrade** → pilih **Blaze**
4. Firebase akan minta akun penagihan (billing account) Google Cloud — kalau
   belum punya, ikuti alur buat akun baru + kartu pembayaran. Ini standar
   Google Cloud, bukan khusus Firebase.
5. Disarankan: langsung pasang **budget alert** (Google Cloud Console →
   Billing → Budgets & alerts) supaya Anda dapat notifikasi kalau pemakaian
   mendekati sesuatu yang tak terduga — bukan untuk project sekecil ini,
   tapi kebiasaan baik.

Kalau project Anda sudah Blaze (banyak project jadi Blaze otomatis begitu
memakai fitur tertentu), lewati langkah ini.

---

## 1. Buat bucket Storage

1. Di Firebase Console, menu kiri → **Build → Storage**
2. Klik **Get started**
3. Muncul dialog aturan keamanan awal — pilih **Start in production mode**.
   Ini penting: aturan produksi berarti *tertutup default* (`allow read,
   write: if false`), dan akan ditimpa otomatis oleh `storage.rules` dari
   repo ini saat deploy pertama lewat GitHub Actions.

   > Jangan pilih "Start in test mode" — mode itu membuka akses baca/tulis
   > ke siapa saja selama 30 hari, dan jangan pernah menempelkan aturan
   > manual lewat Console untuk project ini. `storage.rules` di repo adalah
   > satu-satunya sumber kebenaran; menempel aturan manual pernah
   > menyebabkan aturan aplikasi tertimpa tanpa disadari (lihat catatan di
   > `README.md`).

4. Pilih **lokasi bucket**. Ini keputusan permanen — **tidak bisa diubah
   setelah dibuat**. Yang harus dicek:
   - Buka **Firestore Database → Settings** di tab lain, lihat lokasi
     Firestore Anda (contoh: `asia-southeast2`)
   - Pilih lokasi Storage **yang sama persis**. Beda lokasi antara
     Firestore dan Storage tetap bisa jalan secara teknis, tapi menambah
     latensi setiap kali fitur lampiran dipakai bersamaan dengan data
     Firestore — tidak ada alasan untuk membuatnya beda.
5. Klik **Done**. Bucket dibuat dalam beberapa detik.

---

## 2. Deploy `storage.rules`

Bucket yang baru dibuat masih memakai aturan default (tertutup total). Aturan
sungguhan (`storage.rules` di repo ini) baru aktif setelah di-deploy —
otomatis lewat GitHub Actions begitu branch ini masuk ke `main`.

Kalau Anda ingin memverifikasi tanpa menunggu merge, bisa deploy manual dari
komputer Anda (butuh Firebase CLI, `npm install -g firebase-tools` kalau
belum ada):

```bash
firebase login
firebase deploy --only storage
```

Tapi ini opsional — kalau Anda sudah berencana merge branch
`claude/teacher-student-ai-ecosystem-j5na1k` ke `main` (langkah #3 di
`docs/PANDUAN-LANGKAH-ANDA.md`), deploy otomatis akan menanganinya sekaligus.

---

## 3. Verifikasi berhasil

Dua cara mengecek, pilih salah satu:

**A. Lewat GitHub Actions** (kalau sudah merge ke `main`)

Buka tab **Actions** di GitHub repo → cari run workflow **Deploy Firestore &
Storage Rules** → harus hijau. Kalau merah dan pesannya menyebut bucket tidak
ditemukan / permission denied pada storage, berarti langkah 1 di atas belum
selesai atau bucket dibuat di project Firebase yang salah.

**B. Lewat aplikasi sungguhan**

1. Jalankan `npm run dev` (tanpa env emulator — pastikan
   `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` **tidak** di-set, supaya benar-benar
   menguji Storage produksi)
2. Login sebagai guru → buat tugas → login sebagai siswa (pakai kode akses)
   → kumpulkan jawaban dengan lampiran file
3. Kalau upload berhasil dan guru bisa membuka lampiran dari halaman
   penilaian, Storage sudah aktif dan `storage.rules` sudah ter-deploy benar.

---

## Kalau ada masalah

| Gejala | Kemungkinan sebab |
|---|---|
| Tombol "Get started" di Storage tidak muncul / diarahkan ke halaman upgrade paket | Project masih Spark — selesaikan langkah 0 dulu |
| Deploy `storage.rules` gagal dengan pesan menyebut bucket | Bucket belum dibuat (langkah 1 terlewat), atau nama bucket di `.env.local` (`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`) tidak cocok dengan project Firebase yang aktif |
| Upload di aplikasi gagal dengan `storage/unauthorized` | `storage.rules` belum ter-deploy (masih aturan default tertutup) — cek langkah 2 |
| Upload berhasil tapi lambat | Lokasi bucket beda dari lokasi Firestore — tidak bisa diperbaiki tanpa membuat ulang bucket di lokasi yang sama; untuk sekarang bisa dibiarkan, dampaknya cuma latensi |

Setelah ini selesai, lanjut ke langkah berikutnya di
[`docs/PANDUAN-LANGKAH-ANDA.md`](PANDUAN-LANGKAH-ANDA.md).
