# Audit Kelayakan: Google Drive sebagai Pengganti Firebase Storage

**Status:** Laporan audit — **belum ada kode yang diubah**.
**Cakupan:** lampiran jawaban tugas siswa (`submissions/`) dan materi soal dari guru (`assignment-materials/`).
**Tanggal:** 2026-08-22

---

## 0. Kesimpulan lebih dulu

**Google Drive TIDAK direkomendasikan sebagai pengganti menyeluruh Firebase Storage
untuk aplikasi ini.** Layak secara teknis, tetapi harganya dibayar di tempat yang
paling mahal untuk produk ini: **model keamanan dan kemampuan menguji**.

Tiga temuan yang menentukan:

1. **Siswa login anonim + kode akses, tanpa akun Google** (`app/student/login/page.tsx`
   memanggil `signInAnonymously`). Semua desain Drive yang meminta siswa "login
   dengan Google" langsung membatalkan seluruh model Student Companion. Ini bukan
   trade-off, ini pembatal.
2. **Drive tidak punya padanan `storage.rules`.** Hari ini otorisasi lampiran
   bersifat deklaratif, diberlakukan server Google, dan **teruji penuh**
   (`tests/storage-rules.test.ts`, 20 test). Dengan Drive, seluruh otorisasi itu
   pindah menjadi kode imperatif di route handler kita sendiri — tidak bisa diuji
   dengan emulator, dan aturan keamanan yang tidak bisa diuji persis yang sudah
   ditolak repo ini sebelumnya (lihat komentar kepala `storage.rules`).
3. **Alasan biaya tidak sekuat kelihatannya.** `docs/AKTIFKAN-STORAGE.md` sudah
   menghitung: 100 siswa x 5 tugas berlampiran/bulan x 1 MB = 500 MB/bulan, di
   dalam kuota gratis Blaze 5 GB. Kalau yang dihindari adalah **kewajiban kartu
   kredit**, itu masalah nyata — tapi Drive menukarnya dengan kuota 15 GB yang
   **dibagi bersama Gmail** milik satu orang, yang justru lebih rapuh.

**Yang layak dikerjakan** (kalau tetap ingin jalur Drive): jadikan Drive
**opsi tambahan** untuk workspace yang punya **Google Workspace for Education**
(Shared Drive + service account + domain-wide delegation), bukan pengganti.
Detail di §4 Opsi C dan §10.

---

## 1. Kondisi saat ini — peta kode

Alur lampiran hari ini (satu-satunya jalur, tidak ada duplikat):

```
app/student/tugas/page.tsx          pilih file → validateUploadFile()
  └─ lib/adapters/storageAdapter.ts uploadSubmissionFiles() → uploadBytes + getDownloadURL
       └─ storage.rules             penentu akhir: UID pengunggah dari path, ukuran, contentType
  └─ lib/controllers/submissionController.ts → services → repositories → Firestore
       └─ firestore.rules           siapa boleh menulis dokumen submission
```

| Berkas | Peran hari ini |
|---|---|
| `lib/adapters/storageAdapter.ts` | Satu-satunya tempat SDK Storage disentuh: `uploadSubmissionFile(s)`, `uploadAssignmentFile`, `validateUploadFile`, sanitasi nama file, timeout 45 dtk |
| `lib/utils/uploadFileTypes.ts` | Aturan tipe & ukuran murni (`MAX_UPLOAD_BYTES`, `MAX_SUBMISSION_FILES`, `resolveUploadContentType`) |
| `storage.rules` | Penegak sebenarnya: kepemilikan lewat UID di path, < 10 MB, hanya image/PDF/Word, **`allow delete: if false`** |
| `src/config/firebase.ts` | `getStorage(app)` + `connectStorageEmulator` |
| `app/student/tugas/page.tsx` | Pemanggil upload siswa (maks 5 file), penampil lampiran (`<a href>`) |
| `src/components/assignments/AssignmentsTab.tsx` | Pemanggil `uploadAssignmentFile` (materi guru) |
| `src/components/assignments/AssignmentFormModal.tsx` | `validateUploadFile` sebelum publish |
| `src/components/assignments/SubmissionPanel.tsx` | Guru membuka lampiran lewat `att.fileUrl` |
| `app/student/profil/page.tsx`, `lib/utils/studentStats.ts` | Portofolio siswa membaca `attachments` / `fileUrl` |
| `tests/storage-rules.test.ts` | 20 test aturan Storage di emulator |
| `tests/e2e/smoke.mjs`, `tests/e2e/submission.mjs` | Upload sungguhan di browser + guru membuka lampiran (cek HTTP) |

**Bentuk data yang tersimpan di Firestore** (`lib/services/submissionService.ts`):

```
attachments: [{ fileUrl, fileName, filePath }]   // maks 5
fileUrl / fileName / filePath                    // salinan lampiran pertama, kompatibilitas mundur
```

Ini kabar baik: **UI tidak pernah tahu file itu dari mana.** Semuanya `<a href={fileUrl}>`
— tidak ada `<img src>`, tidak ada SDK Storage di komponen. Selama pengganti tetap
menghasilkan URL yang bisa dibuka di tab baru, **lapisan presentasi nyaris tidak berubah**.

---

## 2. Kenapa Drive dipertimbangkan (asumsi yang dipakai audit ini)

Asumsi: pemicunya adalah **`docs/AKTIFKAN-STORAGE.md` §0** — sejak Oktober 2024
Firebase mewajibkan paket **Blaze (butuh kartu kredit)** untuk membuat bucket
Storage baru. Untuk guru/sekolah di Indonesia, "harus pasang kartu" sering
merupakan penghalang administratif nyata, bukan soal nominal.

Kalau pemicunya berbeda — misalnya guru ingin file jawaban **ada di Drive miliknya
sendiri** supaya bisa dibuka dari HP tanpa aplikasi ini — kesimpulan §10 berubah:
itu jadi kebutuhan produk yang sah, dan jawabannya bukan "ganti storage" melainkan
"ekspor/sinkronisasi ke Drive" (§10.3).

---

## 3. Autentikasi — inti persoalannya

Aplikasi ini punya **dua kelas identitas**, dan Drive hanya cocok untuk satu:

| Aktor | Identitas hari ini | Punya akun Google? |
|---|---|---|
| Guru | Firebase email/password | Belum tentu — daftar pakai email apa pun |
| Siswa | **Firebase anonymous auth** + klaim kode akses | **Hampir pasti tidak**, dan tidak boleh diwajibkan |

Konsekuensi: **tidak ada satu pun jalur di mana siswa mengunggah ke Drive atas
namanya sendiri.** Setiap file harus diunggah atas nama identitas Google *milik
pihak lain* — guru, atau service account sekolah. Itu memaksa **semua** desain
lewat server kita (`app/api/**`), karena kredensial Google tidak boleh pernah
sampai ke browser siswa.

### 3.1 Scope OAuth yang diperlukan

| Scope | Cakupan | Konsekuensi verifikasi |
|---|---|---|
| `drive.file` | Hanya file yang **dibuat oleh aplikasi ini** | Non-sensitive — jalur paling ringan; **inilah yang harus dipakai** |
| `drive` (penuh) | Seluruh Drive pengguna | Restricted — butuh security assessment tahunan berbayar (CASA). **Hindari mutlak** |

> Klasifikasi scope Google berubah dari waktu ke waktu — **wajib dikonfirmasi ulang
> di dokumentasi Google saat implementasi**, bukan dari laporan ini.

Bahaya halus `drive.file`: cakupannya **"semua file yang dibuat aplikasi"**, bukan
"file milik siswa X". Satu access token = akses ke **seluruh** lampiran seluruh siswa
di akun itu. Tidak ada cara mempersempitnya per-siswa. Ini sumber temuan keamanan §6.

---

## 4. Opsi arsitektur

### Opsi A — Siswa login Google, file di Drive siswa
**Ditolak.** Membatalkan model kode akses, memaksa tiap siswa punya akun Google,
menghapus `StudentAuthContext`/`student_login_codes`, dan membuat guru tidak bisa
membuka lampiran tanpa siswa membagikannya manual. Tidak dibahas lebih jauh.

### Opsi B — Service account mengunggah ke My Drive-nya sendiri
**Ditolak.** Google telah membatasi kuota penyimpanan service account yang tidak
terlisensi Workspace; pola ini rapuh dan bisa berhenti bekerja tanpa perubahan kode
di sisi kita. Jangan bangun fitur produksi di atasnya.

### Opsi C — Service account + **Shared Drive** sekolah (Google Workspace) ✅ paling sehat
File dimiliki **Shared Drive**, bukan individu. Service account jadi anggota
Shared Drive.

- Kuota memakai pooled storage Workspace for Education (besar; gratis untuk sekolah
  yang memenuhi syarat).
- Guru bisa diberi peran **Viewer/Commenter** → **tidak bisa menghapus** lampiran.
  Inilah satu-satunya opsi yang mempertahankan semangat `allow delete: if false`.
- File selamat kalau guru resign/akun ditutup.
- **Syarat keras:** sekolah punya domain Google Workspace. Untuk guru individual
  (paket `individual_lifetime`/`individual_onetime`), opsi ini **tidak tersedia**.

### Opsi D — OAuth guru sekali, file di My Drive guru
Guru menyambungkan akun Google-nya sekali; refresh token disimpan server-side;
semua lampiran sekelas masuk ke Drive guru.

- Tersedia untuk semua guru — **inilah satu-satunya opsi yang cocok untuk paket individual**.
- Kuota **15 GB dibagi dengan Gmail & Google Photos guru**. Inbox penuh = pengumpulan
  tugas mati. Kegagalan ini muncul di tempat yang paling tidak terduga.
- Guru **bisa menghapus** file dari aplikasi Drive-nya kapan saja, diam-diam.
  Bukti pengumpulan hilang tanpa jejak di aplikasi — melanggar prinsip yang
  ditulis eksplisit di `storage.rules`.
- Data pekerjaan siswa (identitas anak) berpindah dari penyimpanan milik workspace
  ke **akun pribadi seseorang**. Ini perlu ditimbang terhadap UU PDP dan kebijakan
  sekolah, bukan sekadar keputusan teknis.

### Opsi E — Tetap Firebase Storage
Nol perubahan, seluruh test tetap hijau, `docs/AKTIFKAN-STORAGE.md` sudah
mendokumentasikan cara menjaga biaya Rp0 (budget alert Rp15.000).

---

## 5. Bentuk teknis yang wajib dipakai kalau jalan terus

Dua kendala membuat sebagian besar tutorial Drive di internet **tidak berlaku** di sini:

**(a) Batas body request Vercel ~4,5 MB.** Aplikasi ini deploy di Vercel
(lihat catatan `overrides` di `package.json`). Batas file kita **10 MB**, jadi
**mem-proxy byte file lewat `app/api/**` akan gagal untuk file besar** — persis
untuk foto pekerjaan tulis tangan dari HP modern.

**(b) Access token tidak boleh sampai ke browser.** Satu token = akses ke seluruh
lampiran seluruh siswa (§3.1). Siswa mana pun bisa mengambilnya dari DevTools.

Satu-satunya pola yang lolos keduanya — **resumable upload session**:

```
1. Browser  →  POST /api/drive/upload-session   (Firebase ID token + assignmentId + nama/ukuran/tipe file)
2. Server   :  verifyIdToken  →  cek student_profiles  →  cek workspace, tenggat, status 'dinilai'
               →  validasi ukuran & MIME  →  resolve/buat folder  →  minta session URI ke Drive
3. Server   →  Browser: hanya session URI (sekali pakai, satu file, tanpa bearer token)
4. Browser  →  PUT byte langsung ke Google (melewati Vercel — tidak kena batas 4,5 MB)
5. Browser  →  POST /api/drive/finalize (fileId)
6. Server   :  cocokkan dengan session tercatat  →  set permission 'anyone with link'
               →  kembalikan webViewLink  →  simpan ke dokumen submission
```

Yang harus ada agar langkah 5 tidak bisa dipalsukan: **catatan sesi upload di
Firestore** (koleksi baru `drive_upload_sessions`, tertutup total dari client:
`allow read, write: if false`, hanya ditulis Admin SDK).

Perhatikan: **satu langkah jaringan menjadi tiga.** `withTimeout` yang sekarang
melindungi satu `uploadBytes()` harus dipikirkan ulang untuk tiga titik gagal,
dan setiap titik punya bentuk "setengah jadi" sendiri.

---

## 6. Keamanan — perbandingan langsung

| Aspek | Firebase Storage (sekarang) | Google Drive (usulan) |
|---|---|---|
| Penegak aturan | `storage.rules`, dieksekusi Google | Kode kita sendiri di `app/api/**` |
| Bisa diuji? | **Ya** — emulator + 20 test | **Tidak ada emulator Drive.** Hanya test mock/integrasi berbayar |
| Kepemilikan file | Terbukti dari UID di path | Tidak ada konsep pemilik per-siswa; semua file milik satu akun |
| Isolasi antar siswa | Dijamin path + rules | **Hanya dijamin kode kita.** Satu bug logika = seluruh lampiran sekelas bocor |
| Akses guru | URL bertoken, tersimpan di dokumen submission | URL Drive "anyone with link" — **model risiko identik** |
| Hapus lampiran | `allow delete: if false` — mustahil dari client | Opsi C: bisa dicegah lewat peran. **Opsi D: guru bisa hapus kapan saja** |
| Kebocoran kredensial | Tidak ada kredensial di client | Refresh token guru/sekolah disimpan di sistem kita — **aset bernilai tinggi yang baru** |
| Pencabutan akses | Tidak relevan | Guru cabut akses di myaccount.google.com → **semua link mati serentak**, tanpa peringatan ke aplikasi |

Dua hal yang **tidak** memburuk, supaya adil:

- URL "anyone with link" Drive **tidak lebih lemah** dari download URL bertoken
  Firebase — keduanya sama-sama "URL adalah kuncinya", dan itu memang model yang
  sudah dipilih sadar di repo ini.
- Validasi tipe/ukuran tetap bisa ditegakkan server-side di langkah 2, setara
  dengan `isAllowedUpload()` hari ini.

Yang benar-benar hilang: **kemampuan membuktikan aturan itu benar lewat test.**

---

## 7. Struktur folder Drive

```
Teacher Workspace/                          (root, dicatat sekali per workspace)
└── {workspaceId}/
    ├── submissions/
    │   └── {assignmentId}/
    │       └── {studentId}/
    │           └── 0_foto-jawaban.jpg
    └── assignment-materials/
        └── {assignmentId}/
            └── soal.pdf
```

Cerminan langsung path Storage sekarang — tapi ada tiga jebakan khas Drive:

1. **Drive tidak punya path.** Setiap level harus di-resolve lewat query
   `name = X and '{parentId}' in parents` lalu dibuat kalau belum ada.
   Nested 4 level = sampai 4 panggilan API sebelum byte pertama terkirim.
   **Wajib** menyimpan `driveFolderId` di dokumen workspace & assignment (cache),
   kalau tidak latensi upload naik drastis.
2. **Nama folder boleh kembar.** Dua siswa mengumpulkan bersamaan → dua folder
   `{assignmentId}` terbentuk, dan sebagian lampiran "hilang" ke folder kembar.
   Butuh penguncian/`transaction` saat pembuatan folder pertama kali.
3. **Nama file tidak unik.** Prefix indeks yang sudah ada (`0_`, `1_`) tetap dipakai,
   tapi Drive juga mengizinkan file sebutir nama — jadi `fileId`, bukan nama,
   yang harus jadi acuan (`filePath` → diisi `fileId`).

---

## 8. Batas upload & kuota

| | Firebase Storage | Google Drive |
|---|---|---|
| Batas per file (kita) | 10 MB, ditegakkan `storage.rules` | 10 MB, harus ditegakkan kode kita |
| Batas per file (platform) | — | 5 TB (tidak relevan) |
| Maks file per pengumpulan | 5 (`MAX_SUBMISSION_FILES`) | Sama, tidak berubah |
| Kuota gratis | 5 GB + 1 GB/hari unduhan | Opsi C: pooled Workspace (besar). **Opsi D: 15 GB dibagi Gmail + Photos** |
| Butuh kartu kredit | **Ya (Blaze)** | **Tidak** ← satu-satunya keunggulan nyata |
| Rate limit | Praktis tidak terasa | Kuota Drive API per project & per user — 30 siswa mengumpulkan serentak menjelang tenggat **harus diuji beban**, bukan diasumsikan |

Catatan penting: perilaku "semua siswa mengumpulkan di 10 menit terakhir sebelum
tenggat" itu **normal**, bukan kasus ekstrem. Dengan Drive, ledakan itu menabrak
kuota API bersama seluruh workspace di satu project Google Cloud.

---

## 9. Risiko

| # | Risiko | Dampak | Kemungkinan | Mitigasi |
|---|---|---|---|---|
| R1 | Hilangnya `storage.rules` yang teruji → otorisasi jadi kode imperatif tanpa emulator | **Kritis** | Pasti | Test integrasi terhadap Drive sungguhan di project uji + review ketat; tetap lebih lemah dari sekarang |
| R2 | Guru menghapus lampiran dari Drive-nya (Opsi D) → bukti pengumpulan hilang diam-diam | **Kritis** | Sedang | Hanya bisa dicegah di Opsi C (Shared Drive + peran Viewer) |
| R3 | Kuota 15 GB guru penuh karena Gmail → pengumpulan tugas mati (Opsi D) | Tinggi | Sedang | Cek `about.get` storageQuota sebelum upload + peringatkan guru; tidak menyelesaikan akar masalah |
| R4 | Guru mencabut akses aplikasi / ganti akun → **seluruh lampiran lama tidak bisa dibuka** | Tinggi | Sedang | Deteksi refresh token invalid + banner; file lama tetap tidak terjangkau |
| R5 | Access token bocor ke browser oleh implementasi yang salah → semua lampiran sekelas terekspos | Tinggi | Rendah (kalau pola §5 dipatuhi) | Wajib pola resumable session; token tidak pernah dikirim ke client |
| R6 | `tests/e2e/smoke.mjs` & `submission.mjs` tidak lagi bisa jalan offline (tak ada emulator Drive) | Tinggi | Pasti | Fake Drive server lokal, atau pertahankan Firebase Storage khusus jalur test — keduanya menambah utang |
| R7 | Upload sukses tapi `finalize` gagal → file yatim di Drive, submission tak tercatat | Sedang | Sedang | Sudah ada risiko serupa hari ini; perlu retry idempoten via `drive_upload_sessions` |
| R8 | Folder kembar akibat pembuatan bersamaan → lampiran "hilang" | Sedang | Sedang | Cache `driveFolderId` + transaction saat pembuatan pertama |
| R9 | Kuota Drive API tertabrak saat lonjakan menjelang tenggat | Sedang | Sedang | Uji beban 30–40 upload serentak sebelum rilis |
| R10 | Data pekerjaan siswa berpindah ke akun Google pribadi guru (PDP) | Sedang | Pasti (Opsi D) | Persetujuan sekolah tertulis; atau pakai Opsi C |
| R11 | Kebijakan scope/verifikasi OAuth Google berubah sepihak | Sedang | Rendah | Kunci di `drive.file`; jangan pernah minta scope `drive` penuh |
| R12 | Migrasi lampiran lama | Rendah | — | **Tidak perlu migrasi**: URL Firebase lama tetap valid selama bucket hidup. `storage.rules` **wajib tetap ter-deploy** |

---

## 10. Apa yang harus tetap utuh — pemeriksaan satu per satu

Semua yang di bawah ini diminta dipertahankan, dan sudah diperiksa terhadap kodenya:

| Yang dipertahankan | Terpengaruh? | Catatan |
|---|---|---|
| Alur submission siswa | Sebagian | `handleSubmit` di `app/student/tugas/page.tsx` tetap sama; hanya satu baris `uploadSubmissionFiles` yang berpindah adapter |
| `canStudentSubmit` / gerbang tenggat & 'dinilai' | **Tidak** | Murni Firestore, tidak menyentuh storage sama sekali |
| Review guru (`SubmissionPanel`) | **Tidak** | Membaca `att.fileUrl` sebagai `<a href>` — URL Drive bekerja apa adanya |
| Catatan guru (feedback) terpisah dari nilai | **Tidak** | `saveSubmissionFeedback` tidak menyentuh storage |
| Penilaian + kunci nilai + `hasSubmitted` | **Tidak** | Jalur `grades`, tidak menyentuh storage |
| `firestore.rules` (submissions) | **Tidak**, asal nama field dipertahankan | `hasStudentWork()` memeriksa `fileUrl`/`attachments` — **jangan ganti nama field ini** |
| Fix contentType octet-stream | Tetap perlu | Drive juga butuh `mimeType`; `resolveUploadContentType` dipakai ulang apa adanya |
| Fix timeout upload menggantung | **Perlu dikerjakan ulang** | Satu langkah jadi tiga (§5) |
| Fix penjaga klik ganda | **Tidak** | `submittingRef` di lapisan UI |
| Fix multi-lampiran maks 5 | **Tidak** | Batasnya di `uploadFileTypes.ts` |
| `allow delete: if false` | **Terancam** | Hanya bertahan di Opsi C (§4) |
| Login siswa tanpa akun Google | **Wajib utuh** | Setiap desain yang melanggar ini otomatis gugur (§3) |

### 10.1 Berkas yang akan berubah

**Baru:**
- `lib/adapters/driveAdapter.ts` — pengganti sisi client, **signature identik** dengan `storageAdapter.ts` (`{ fileUrl, fileName, filePath }`) supaya pemanggil tidak berubah
- `lib/server/driveService.ts` — Drive API (server-only, di samping `firebaseAdmin.ts`)
- `lib/server/googleOAuth.ts` — refresh token → access token
- `app/api/drive/upload-session/route.ts`, `app/api/drive/finalize/route.ts`
- `app/api/drive/connect/route.ts` + `callback/route.ts` — penyambungan akun guru (Opsi D)
- `lib/utils/driveFolders.ts` — resolve/cache folder (murni sebisa mungkin, agar bisa di-unit-test)
- `docs/GOOGLE-DRIVE-SETUP.md`

**Diubah:**
- `lib/adapters/storageAdapter.ts` — **jangan dihapus**; tetap untuk membaca lampiran lama
- `lib/services/submissionService.ts` — tambah `provider: 'firebase' | 'drive'` per lampiran
- `lib/services/assignmentService.ts`, `lib/controllers/assignmentController.ts` — materi guru
- `src/components/assignments/AssignmentFormModal.tsx`, `AssignmentsTab.tsx` — jalur import
- `app/student/tugas/page.tsx` — jalur import
- `firestore.rules` — koleksi baru `drive_upload_sessions` (**tertutup total**) + field token workspace (tertutup total)
- `src/config/firebase.ts` — `storage` tetap ada selama masa transisi
- `package.json` — `google-auth-library` (**jangan** `googleapis` penuh — terlalu besar untuk kebutuhan ini)
- `README.md`, `docs/AKTIFKAN-STORAGE.md` — status berubah
- `.env` — `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`

**Test:**
- `tests/storage-rules.test.ts` — **dipertahankan** (lampiran lama masih dilindunginya)
- `tests/drive-authorization.test.ts` — baru, menguji logika otorisasi route (bukan Drive-nya)
- `tests/e2e/smoke.mjs`, `tests/e2e/submission.mjs` — **butuh strategi baru** (R6)

**Tidak disentuh sama sekali:** `SubmissionPanel.tsx`, `submissionRules.ts`,
`submissionController.ts`, `submissionRepository.ts`, `gradeRepository.ts`,
`studentStats.ts`, `app/student/profil/page.tsx`.

### 10.2 Perkiraan usaha

Sekitar **1.200–1.800 baris** kode baru/berubah, **3–5 hari kerja**, ditambah waktu
tunggu di luar kendali kita: pembuatan OAuth client, konfigurasi consent screen,
dan (kalau sekolah dilibatkan) domain-wide delegation. Bandingkan dengan Opsi E:
nol baris.

### 10.3 Alternatif yang lebih murah kalau tujuannya "guru ingin file di Drive-nya"

Kalau kebutuhan sebenarnya bukan mengganti storage melainkan agar guru punya
salinan di Drive: **pertahankan Firebase Storage sebagai sumber kebenaran**, lalu
tambahkan tombol *"Salin lampiran kelas ini ke Drive saya"*. Satu arah, dijalankan
guru sendiri, dengan akun Google guru sendiri. Nol perubahan pada `storage.rules`,
`firestore.rules`, alur submission, dan seluruh test — dan tidak satu pun risiko
R1/R2/R3/R6 muncul.

---

## 11. Rekomendasi

1. **Jangan mengganti Firebase Storage dengan Drive untuk paket individual.**
   Risiko R2 (guru menghapus bukti pengumpulan) dan R3 (kuota bercampur Gmail)
   menyerang tepat pada properti yang paling ingin dijaga aplikasi ini.
2. **Kalau sekolah punya Google Workspace for Education**, Opsi C (Shared Drive +
   service account) layak dikembangkan sebagai **backend penyimpanan opsional
   per-workspace** — bukan pengganti. `provider` per lampiran membuat keduanya
   bisa hidup berdampingan tanpa migrasi.
3. **Kalau motivasinya murni menghindari kartu kredit**, keputusan yang jauh lebih
   murah adalah menjalankan §0.5 `docs/AKTIFKAN-STORAGE.md` (budget alert Rp15.000)
   dan mengukur pemakaian nyata setelah 2–4 minggu.
4. **Syarat masuk sebelum baris kode pertama ditulis** (kalau tetap lanjut):
   - Terkonfirmasi: sekolah punya domain Google Workspace + izin membuat Shared Drive
   - Terjawab: bagaimana `tests/e2e/*.mjs` tetap bisa jalan tanpa emulator Drive (R6)
   - Terjawab: siapa pemilik data pekerjaan siswa secara hukum (R10)
   - Terbukti: uji beban 30–40 upload serentak tidak menabrak kuota Drive API (R9)

Selama keempat syarat itu belum terjawab, mengganti storage berarti menukar
sistem yang **terbukti benar lewat test** dengan sistem yang **hanya diyakini benar** —
persisnya alasan yang sudah ditolak repo ini sebelumnya, tertulis di kepala
`storage.rules`.
