# Analisis uji beban (sekolah besar)

Data mentah: [`LOAD-TEST.md`](./LOAD-TEST.md) (dihasilkan `npm run loadtest`, 97 ribu dokumen: 36 kelas × 36 siswa, 60 guru, 1 tahun ajaran).

## Temuan utama (setelah optimasi Beranda & Student Companion)
- **Bacaan Firestore tetap biaya utama, tapi turun jauh.** Profil standar: ≈ **31 juta bacaan/bulan** ≈ **US$ 18,8 ≈ Rp 300 ribu/bulan** (harga perkiraan US$ 0,06/100 ribu bacaan — verifikasi untuk region Anda). Sebelumnya ≈ 88 juta/bulan ≈ Rp 844 ribu.
- **Dibanding pendapatan:** paket sekolah tahunan Rp 240 ribu per kursi × 60 guru ≈ Rp 1,2 juta/bulan → Firestore ≈ **15% dari pendapatan** (sebelumnya ≈ 70%).
- **Koreksi angka lama (jujur):** skenario Student Companion versi lama membuka *semua halaman siswa sekaligus* setiap kali, sehingga biaya siswa **dilebih-lebihkan**. Sekarang tiap halaman diukur sendiri dengan frekuensi buka masing-masing. Sebagian "penurunan" di tabel ini berasal dari koreksi tersebut, bukan dari optimasi.
- **Yang dioptimasi (terukur):** Beranda guru buka berikutnya 2.343 → **315 bacaan** (−87%); Kehadiran siswa buka berikutnya 720 → **24 bacaan** (−97%). Buka *pertama* di perangkat baru tetap penuh (2.343 / 720).
- **Analitik (sinkron bertahap):** hari lampau diringkas jadi rekap kecil per siswa di perangkat; hanya 3 hari terakhir dibaca ulang, jumlah pengumpulan tugas lewat agregat, jumlah siswa per kelas dari cache daftar kelas. Buka pertama 12.060 → **7.920** bacaan; buka setelah cache hasil kedaluwarsa → **2.160**; buka berikutnya (≤30 menit) → **0**. Temuan identik dengan perhitungan penuh (`tests/insight-sync.test.ts`).
- **Daftar kelas:** buka berikutnya 0 bacaan (cache perangkat 10 menit); buka pertama masih 1.296.
- **Batas kebasian Analitik:** presensi/jurnal hari yang lebih tua dari 3 hari yang diubah belakangan baru terlihat pada sinkron penuh (tiap 7 hari) atau setelah keluar-masuk akun; jurnal yang disimpan tidak membuang cache hasil (≤30 menit).
- **Per guru (dikerjakan):** Beranda dan Analitik kini hanya memuat kelas milik guru yang login (kelas dari jadwal miliknya + kelas wali). Guru contoh di uji beban mengajar ±3 dari 36 kelas (asumsi — guru nyata mungkin 5–8 kelas, jadi hemat nyata lebih kecil). Beranda buka berikutnya 315 → **28** bacaan; Analitik buka pertama 7.920 → **2.700**. OWNER/ADMIN tetap melihat seluruh workspace di Analitik (7.920, pengawasan). Buka *pertama* di perangkat baru masih memuat semua jadwal+kelas (≈2.000) — dibagi dengan halaman Kelas.
- **Privasi perangkat:** cache di perangkat dihapus saat keluar akun.

## Yang dikerjakan & batasnya
- Beranda: hanya dokumen **hari ini** (jurnal+presensi) + angka agregat 6 hari lalu; daftar kelas & jadwal disimpan di perangkat (TTL 10 menit, dibuang otomatis saat guru menyimpan perubahan di perangkat itu). Keluaran Beranda **identik** (tes ekuivalensi `tests/dashboard-summary-equivalence.test.ts`). Konsekuensi: perubahan siswa/jadwal dari perangkat *lain* baru terlihat ≤10 menit.
- **Cara menentukan "milik saya":** jadwal dengan `createdBy` = uid ATAU tanpa `createdBy`. `createdBy` baru dicap sejak 2026-11-08, jadi data lama dianggap milik semua guru sampai dibuat ulang/diedit; guru di workspace multi-guru baru benar-benar terpisah untuk jadwal baru. Guru tanpa jadwal/kelas wali melihat Beranda/Analitik kosong.
- Presensi siswa: sinkron penuh sekali, lalu jendela 7 hari + sinkron penuh ulang tiap 14 hari. Perubahan guru pada pertemuan yang lebih tua dari 7 hari baru terlihat paling lama 14 hari (atau setelah siswa keluar-masuk). Sesi presensi yang sudah dihapus-lunak kini tidak ikut dihitung.

## Penyebab dan perbaikan (urut dampak)
| # | Penyebab | Bukti (bacaan / data) | Perbaikan | Status |
|---|---|---|---|---|
| 1 | **Beranda** membaca siswa, jadwal, jurnal dan presensi 7 hari seluruh sekolah | 2.343 → 315 (buka berikutnya) | Hari ini saja + agregat + cache perangkat | ✅ sebagian (per-guru belum) |
| 2 | **Student Companion** membaca seluruh riwayat presensi kelas | 720 → 24 (buka berikutnya) | Sinkron bertahap | ✅ |
| 3 | **Analitik** membaca presensi + jurnal 30 hari seluruh sekolah | 12.060 → 7.920 (pertama) → 2.160 (sinkron) → 0 (cache) | Sinkron bertahap + agregat + per guru ✅ | ✅ |
| 4 | **Daftar kelas** membaca semua siswa hanya untuk menghitung jumlah per kelas | 1.296 → 0 (buka berikutnya) | Cache perangkat ✅; buka pertama masih 1.296 — dokumen ringkasan kelas bila perlu | ✅ sebagian |
| 5 | **Riwayat presensi/jurnal** satu kelas memuat satu tahun penuh | 720 / 2,4 MB | Tampilkan bulan berjalan dulu, "muat lebih lama" bila perlu (paginasi) | ~85% |
| 6 | **Jadwal** membaca jadwal seluruh sekolah | 720 | Hanya jadwal milik guru | ~90% |

Perbaikan 3–4 berikutnya diperkirakan menurunkan lagi sebagian besar sisa biaya.

## Catatan metodologi (jujur)
- Jumlah bacaan/dokumen/ukuran **eksak** untuk data seeded; **waktu emulator bukan latensi produksi**. Waktu unduh adalah perkiraan @1,5 Mbps.
- Profil pemakaian (jumlah buka per hari, 60% siswa aktif) adalah **asumsi** di `scripts/loadtest/school.loadtest.ts`; ubah dan jalankan ulang. Biaya linear terhadap asumsi itu — ukur pemakaian nyata saat pilot.
- Cache sesi (`lib/utils/sessionCache.ts`) dan cache Firestore di perangkat menurunkan bacaan berulang; cache memori ini tidak dimodelkan (angka konservatif); cache perangkat baru dimodelkan lewat skenario "buka pertama" vs "buka berikutnya".
- Seeded semua presensi di satu workspace; data nyata biasanya tidak serapi ini. Hanya Firestore: biaya Vercel, Supabase, Auth, dan Storage terpisah.
- Menjalankan ulang: `LOADTEST_SCALE=1 LOADTEST_OUT=docs/LOAD-TEST.md npm run loadtest` (≈ 25 menit); `LOADTEST_SCALE=0.1` untuk uji cepat. Harga: `LOADTEST_PRICE_READ_PER_100K`, `LOADTEST_PRICE_WRITE_PER_100K`, `LOADTEST_USD_IDR`.

## Rekomendasi
Kerjakan perbaikan 3–4 (dan per-guru untuk Beranda) **sebelum** menjual paket sekolah besar, atau naikkan harga per kursi untuk sekolah > ±500 siswa. Ulangi `npm run loadtest` setelah tiap perbaikan; angka "Bacaan" per alur adalah ukuran keberhasilan.
