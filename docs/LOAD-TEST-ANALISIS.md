# Analisis uji beban (sekolah besar)

Data mentah: [`LOAD-TEST.md`](./LOAD-TEST.md) (dihasilkan `npm run loadtest`, 97 ribu dokumen: 36 kelas × 36 siswa, 60 guru, 1 tahun ajaran).

## Temuan utama (setelah optimasi Beranda & Student Companion)
- **Bacaan Firestore tetap biaya utama, tapi turun jauh.** Profil standar: ≈ **31 juta bacaan/bulan** ≈ **US$ 18,8 ≈ Rp 300 ribu/bulan** (harga perkiraan US$ 0,06/100 ribu bacaan — verifikasi untuk region Anda). Sebelumnya ≈ 88 juta/bulan ≈ Rp 844 ribu.
- **Dibanding pendapatan:** paket sekolah tahunan Rp 240 ribu per kursi × 60 guru ≈ Rp 1,2 juta/bulan → Firestore ≈ **20% dari pendapatan** (sebelumnya ≈ 70%).
- **Koreksi angka lama (jujur):** skenario Student Companion versi lama membuka *semua halaman siswa sekaligus* setiap kali, sehingga biaya siswa **dilebih-lebihkan**. Sekarang tiap halaman diukur sendiri dengan frekuensi buka masing-masing. Sebagian "penurunan" di tabel ini berasal dari koreksi tersebut, bukan dari optimasi.
- **Yang dioptimasi (terukur):** Beranda guru buka berikutnya 2.343 → **315 bacaan** (−87%); Kehadiran siswa buka berikutnya 720 → **24 bacaan** (−97%). Buka *pertama* di perangkat baru tetap penuh (2.343 / 720).
- **Alur terbesar yang tersisa:** Analitik buka pertama (≈12.060 bacaan; buka berikutnya 0 selama ≤30 menit), lalu Beranda, riwayat presensi/jurnal per kelas (720).
- **Daftar kelas & Analitik:** hasil jadinya disimpan di perangkat (daftar kelas 10 menit, Analitik 30 menit; dibuang saat guru menyimpan perubahan di perangkat itu). Buka berikutnya = 0 bacaan. **Bacaan buka pertama Analitik TIDAK turun** — itu butuh ringkasan terjadwal di server atau pembatasan per guru (perubahan perilaku/arsitektur, menunggu persetujuan). Jurnal yang disimpan tidak membuang cache ini, jadi temuan bisa tertinggal ≤30 menit.
- **Privasi perangkat:** cache di perangkat dihapus saat keluar akun.

## Yang dikerjakan & batasnya
- Beranda: hanya dokumen **hari ini** (jurnal+presensi) + angka agregat 6 hari lalu; daftar kelas & jadwal disimpan di perangkat (TTL 10 menit, dibuang otomatis saat guru menyimpan perubahan di perangkat itu). Keluaran Beranda **identik** (tes ekuivalensi `tests/dashboard-summary-equivalence.test.ts`). Konsekuensi: perubahan siswa/jadwal dari perangkat *lain* baru terlihat ≤10 menit.
- Beranda masih **seluruh workspace** (belum per guru) — sisa 315 bacaan hampir seluruhnya dokumen hari ini milik semua guru. Pembatasan per guru mengubah tampilan, jadi belum dikerjakan; butuh persetujuan.
- Presensi siswa: sinkron penuh sekali, lalu jendela 7 hari + sinkron penuh ulang tiap 14 hari. Perubahan guru pada pertemuan yang lebih tua dari 7 hari baru terlihat paling lama 14 hari (atau setelah siswa keluar-masuk). Sesi presensi yang sudah dihapus-lunak kini tidak ikut dihitung.

## Penyebab dan perbaikan (urut dampak)
| # | Penyebab | Bukti (bacaan / data) | Perbaikan | Status |
|---|---|---|---|---|
| 1 | **Beranda** membaca siswa, jadwal, jurnal dan presensi 7 hari seluruh sekolah | 2.343 → 315 (buka berikutnya) | Hari ini saja + agregat + cache perangkat | ✅ sebagian (per-guru belum) |
| 2 | **Student Companion** membaca seluruh riwayat presensi kelas | 720 → 24 (buka berikutnya) | Sinkron bertahap | ✅ |
| 3 | **Analitik** (buka pertama; buka berikutnya sudah 0 lewat cache) membaca presensi + jurnal 30 hari seluruh sekolah | 10.692 / 13,5 MB, 74 dtk @1,5 Mbps | Hitung di server/terjadwal dan simpan ringkasannya; atau batasi per guru | ~90% |
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
