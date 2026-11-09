# Analisis uji beban (sekolah besar)

Data mentah: [`LOAD-TEST.md`](./LOAD-TEST.md) (dihasilkan `npm run loadtest`, 97 ribu dokumen: 36 kelas × 36 siswa, 60 guru, 1 tahun ajaran).

## Temuan utama
- **Bacaan Firestore adalah biaya utama.** Dengan profil pemakaian standar, satu sekolah besar membaca ≈ **88 juta dokumen/bulan** ≈ **US$ 53 ≈ Rp 844 ribu/bulan** (harga perkiraan US$ 0,06/100 ribu bacaan — verifikasi untuk region Anda; region tunggal bisa lebih murah).
- **Dibanding pendapatan:** paket sekolah tahunan Rp 240 ribu per kursi × 60 guru = Rp 14,4 juta/tahun ≈ Rp 1,2 juta/bulan. Biaya Firestore saja ≈ **70% dari pendapatan** sekolah sebesar ini. Sekolah kecil lebih aman, sekolah besar tidak menguntungkan tanpa optimasi.
- **Tiga alur menyumbang ±82% bacaan**: Beranda guru (42%), Student Companion (32%), Analitik (8%) + daftar kelas (6%).

## Penyebab dan perbaikan (urut dampak)
| # | Penyebab | Bukti (bacaan / data) | Perbaikan | Perkiraan hemat |
|---|---|---|---|---|
| 1 | **Beranda** membaca siswa, jadwal, jurnal dan presensi 7 hari untuk **seluruh sekolah**, padahal seorang guru hanya mengajar sebagian kelas | 3.483 / 2,9 MB | Batasi ke kelas milik guru itu (jadwal buatannya) + dokumen ringkasan harian | ~80% |
| 2 | **Student Companion** membaca **seluruh riwayat presensi kelas** (720 dokumen, 2,4 MB) hanya untuk menghitung presensi satu siswa | 821 / 2,4 MB | Simpan ringkasan presensi per siswa (atau batasi ke bulan berjalan) | ~85% |
| 3 | **Analitik** membaca presensi + jurnal 30 hari seluruh sekolah | 10.692 / 13,5 MB, 74 dtk @1,5 Mbps | Hitung di server/terjadwal dan simpan ringkasannya; atau batasi per guru | ~90% |
| 4 | **Daftar kelas** membaca semua siswa hanya untuk menghitung jumlah per kelas | 1.296 / 172 KB | Dokumen ringkasan kelas (jumlah siswa) yang diperbarui saat siswa ditambah/dihapus | ~99% |
| 5 | **Riwayat presensi/jurnal** satu kelas memuat satu tahun penuh | 720 / 2,4 MB | Tampilkan bulan berjalan dulu, "muat lebih lama" bila perlu (paginasi) | ~85% |
| 6 | **Jadwal** membaca jadwal seluruh sekolah | 720 | Hanya jadwal milik guru | ~90% |

Memperkirakan perbaikan 1–4 saja: bacaan ≈ −75–80% → biaya Firestore ≈ Rp 170–210 ribu/bulan (≈ 15% pendapatan) untuk sekolah yang sama.

## Catatan metodologi (jujur)
- Jumlah bacaan/dokumen/ukuran **eksak** untuk data seeded; **waktu emulator bukan latensi produksi**. Waktu unduh adalah perkiraan @1,5 Mbps.
- Profil pemakaian (jumlah buka per hari, 60% siswa aktif) adalah **asumsi** di `scripts/loadtest/school.loadtest.ts`; ubah dan jalankan ulang. Biaya linear terhadap asumsi itu — ukur pemakaian nyata saat pilot.
- Cache sesi (`lib/utils/sessionCache.ts`) dan cache Firestore di perangkat menurunkan bacaan berulang; model ini tidak memperhitungkannya, jadi angka cenderung konservatif (tinggi).
- Seeded semua presensi di satu workspace; data nyata biasanya tidak serapi ini. Hanya Firestore: biaya Vercel, Supabase, Auth, dan Storage terpisah.
- Menjalankan ulang: `LOADTEST_SCALE=1 LOADTEST_OUT=docs/LOAD-TEST.md npm run loadtest` (≈ 25 menit); `LOADTEST_SCALE=0.1` untuk uji cepat. Harga: `LOADTEST_PRICE_READ_PER_100K`, `LOADTEST_PRICE_WRITE_PER_100K`, `LOADTEST_USD_IDR`.

## Rekomendasi
Kerjakan perbaikan 1–4 **sebelum** menjual paket sekolah besar, atau naikkan harga per kursi untuk sekolah > ±500 siswa. Ulangi `npm run loadtest` setelah tiap perbaikan; angka "Bacaan" per alur adalah ukuran keberhasilan.
