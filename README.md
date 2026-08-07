# Teacher Workspace + Student Companion

Dua aplikasi dengan satu backend Firestore:

- **Teacher Workspace** (`/`) — pusat operasional guru: jurnal mengajar, presensi,
  nilai, tugas, pengumuman, analitik, plus menu khusus wali kelas.
- **Student Companion** (`/student`) — pendamping siswa: jadwal, tugas &
  pengumpulan, nilai, kehadiran, pengumuman, profil & portofolio.

Keduanya hidup di satu project Next.js ini, tapi dengan sesi auth yang terpisah:
guru memakai email/kata sandi, siswa memakai **kode akses** yang dibagikan
gurunya.

## Menjalankan

### 1. Siapkan env

Buat `.env.local` berisi konfigurasi Firebase project kamu:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### 2. Jalankan

```bash
npm install
npm run dev
```

### Menjalankan dengan emulator (tanpa menyentuh data produksi)

Direkomendasikan untuk mencoba-coba. Butuh JDK 21+ (dipakai Firebase Emulator).

```bash
npm run emulators          # terminal 1: auth, firestore, storage
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true npm run dev   # terminal 2
```

Selama env `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` tidak di-set, aplikasi **selalu**
menunjuk ke Firebase sungguhan — tidak ada jalan produksi diam-diam bicara ke
emulator atau sebaliknya.

## Test

```bash
npm run test:rules   # aturan keamanan Firestore & Storage, di atas emulator
npm run test:e2e     # alur guru <-> siswa di browser sungguhan
```

**`test:rules`** menjalankan seluruh berkas di `tests/` termasuk test logika
murni (`analytics.test.ts`, `student-stats.test.ts`) yang sebenarnya tidak butuh
emulator.

**`test:e2e`** membangun aplikasi lalu menelusurinya di Chromium: guru mendaftar
→ tambah siswa → kode akses → buat tugas → siswa masuk → kumpulkan jawaban +
lampiran → guru menilai → nilai sampai ke siswa. Jalankan dengan `E2E_VERBOSE=1`
untuk melihat log server, atau `E2E_SKIP_BUILD=true` untuk memakai build yang
sudah ada.

Kalau sebuah langkah gagal, tangkapan layar disimpan di `/tmp/e2e-gagal-*.png`
beserta cuplikan teks halaman — supaya "tidak ditemukan" bisa dibedakan antara
salah aplikasi dan salah selektor.

## Struktur

Berlapis, dan lapisannya tidak boleh dilompati:

```
app/            Halaman Next.js (guru di root, siswa di app/student)
src/components/ Komponen UI
src/context/    Sesi guru (WorkspaceContext) & sesi siswa (StudentAuthContext)
lib/controllers Dipanggil UI; mengurus cache
lib/services    Aturan bisnis & validasi
lib/repositories Query Firestore
lib/adapters    Pembungkus SDK Firestore/Storage
lib/utils       Perhitungan murni (tanpa I/O — inilah yang di-unit-test)
```

Perhitungan yang bisa salah diam-diam (rata-rata nilai, rekap kehadiran, temuan
analitik) sengaja ditaruh di `lib/utils` sebagai fungsi murni supaya bisa diuji
tanpa Firestore sama sekali.

## Catatan penting

**Query siswa wajib memakai filter yang menjamin cakupannya.** Firestore
mengevaluasi aturan `list` berbeda dari `get`: sebuah query hanya diizinkan bila
filternya membuktikan semua hasilnya lolos aturan. Contoh: nilai harus di-query
dengan `workspaceId` + `studentId`, bukan `className` — kalau tidak, halamannya
kosong walau aturannya benar. Lihat `tests/firestore-rules.test.ts` bagian
"query (list)".

**Prestasi tinggal di koleksi sendiri** (`student_achievements`), bukan di
`student_notes`. `student_notes` juga memuat catatan konseling dan tidak pernah
dibuka untuk siswa — memisahkan prestasi membuat kesalahan aturan apa pun tidak
bisa menyentuh data konseling.

**Guru membaca lampiran tugas lewat download URL bertoken**, bukan lewat Storage
rules. Cross-service rules (`firestore.get` dari storage.rules) tidak berfungsi
di emulator sehingga tidak bisa diuji, dan aturan keamanan yang tidak bisa diuji
lebih berbahaya daripada aturan sederhana yang terbukti jalan.

## Deploy & operasional

- **Rules** — `firestore.rules`, `firestore.indexes.json`, dan `storage.rules`
  ter-deploy otomatis lewat GitHub Actions saat berubah di `main`. Jangan
  menempel rules manual lewat Firebase Console; itu pernah menyebabkan rules
  aplikasi ini tertimpa tanpa disadari.
- **Backup** — Firestore di-backup otomatis tiap hari. Setup dan cara restore
  ada di [`docs/BACKUP.md`](docs/BACKUP.md).
- **Utang teknis** yang sengaja ditunda tercatat di
  [`docs/TECHNICAL_DEBT.md`](docs/TECHNICAL_DEBT.md).

### Sekali di awal

Firebase **Storage harus diaktifkan** di Firebase Console (Build → Storage → Get
started) sebelum deploy rules pertama, kalau belum. Tanpa bucket, deploy
`storage.rules` akan gagal dan upload lampiran tidak berfungsi.

## Prinsip produk

Setiap fitur baru harus menjawab satu pertanyaan:

> Apakah fitur ini benar-benar mengurangi pekerjaan guru, atau meningkatkan
> pengalaman belajar siswa?

Kalau tidak, fitur itu tidak perlu ditambahkan. Student Companion khususnya
**bukan LMS** — tidak ada video, forum, chat, materi, atau e-book.
