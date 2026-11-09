# Uji beban dan estimasi biaya Firestore

Dihasilkan otomatis oleh `npm run loadtest` pada 2026-11-09 (skala 1).

> **Cara membaca.** Jumlah bacaan (reads), dokumen, dan ukuran data **eksak** (dihitung dari kode aplikasi yang sebenarnya terhadap data seeded). **Waktu (ms) berasal dari emulator lokal** — bukan latensi jaringan produksi; pakai kolom "perkiraan unduh" untuk gambaran di jaringan seluler. **Harga adalah perkiraan list-price: verifikasi dengan halaman harga Firestore untuk region Anda.** Biaya ini hanya Firestore (bukan Vercel, Supabase, Auth, Storage, Midtrans).

## Data uji

36 kelas × 36 siswa, 60 guru, 180 hari sekolah, 4 jam/kelas/hari. Total **97.128** dokumen:

| Koleksi | Dokumen |
|---|---:|
| submissions | 26.028 |
| attendances | 25.920 |
| journals | 25.920 |
| grades | 15.552 |
| students | 1.296 |
| assignments | 900 |
| schedules | 720 |
| grade_columns | 432 |
| announcements | 360 |

## Biaya per alur (sekali dibuka)

| Alur | Pengguna | Bacaan | Query | Data (KB) | Waktu emulator (ms) | Perkiraan unduh @1500 kbps (dtk) | Catatan |
|---|---|---:|---:|---:|---:|---:|---|
| Guru: Beranda — buka pertama (cache perangkat kosong) | guru | 2.343 | 21 | 809 | 2811 | 4.4 | sangat berat |
| Guru: Beranda — buka berikutnya (cache perangkat terisi) | guru | 315 | 4 | 540 | 765 | 3.0 |  |
| Guru: daftar kelas | guru | 1.296 | 3 | 172 | 207 | 0.9 | berat |
| Guru: detail kelas (siswa) | guru | 36 | 1 | 4.7 | 37 | 0.0 |  |
| Guru: riwayat presensi satu kelas | guru | 720 | 1 | 2410 | 622 | 13.2 | berat |
| Guru: riwayat jurnal satu kelas | guru | 720 | 1 | 252 | 346 | 1.4 | berat |
| Guru: tabel nilai kelas | guru | 444 | 2 | 51.8 | 209 | 0.3 |  |
| Guru: pengumpulan satu tugas | guru | 66 | 2 | 22.5 | 298 | 0.1 |  |
| Guru: Analitik | guru | 10.692 | 10 | 13479 | 24580 | 73.6 | sangat berat |
| Guru: Jadwal | guru | 720 | 2 | 96.2 | 141 | 0.5 | berat |
| Siswa: Beranda (pengumuman) | siswa | 10 | 1 | 1.4 | 32 | 0.0 |  |
| Siswa: Jadwal | siswa | 20 | 1 | 2.6 | 39 | 0.0 |  |
| Siswa: Tugas | siswa | 46 | 2 | 18.1 | 351 | 0.1 |  |
| Siswa: Nilai | siswa | 24 | 2 | 2.6 | 163 | 0.0 |  |
| Siswa: Kehadiran — buka pertama (sinkron penuh) | siswa | 720 | 1 | 2410 | 636 | 13.2 | berat |
| Siswa: Kehadiran — buka berikutnya (sinkron jendela 7 hari) | siswa | 24 | 1 | 80.3 | 279 | 0.4 |  |

## Estimasi bulanan untuk satu sekolah

Asumsi: 60 guru, 1296 siswa (60% aktif per hari sekolah), 22 hari sekolah/bulan.

| Alur | Pelaku | Bacaan/hari | Porsi |
|---|---|---:|---:|
| Guru: Analitik | guru | 320.760 | 23% |
| Guru: daftar kelas | guru | 233.280 | 16% |
| Guru: riwayat presensi satu kelas | guru | 172.800 | 12% |
| Guru: Beranda — buka pertama (cache perangkat kosong) | guru | 140.580 | 10% |
| Guru: Beranda — buka berikutnya (cache perangkat terisi) | guru | 132.300 | 9% |
| Guru: riwayat jurnal satu kelas | guru | 129.600 | 9% |
| Guru: Jadwal | guru | 86.400 | 6% |
| Guru: tabel nilai kelas | guru | 79.920 | 6% |
| Siswa: Tugas | siswa | 35.770 | 3% |
| Siswa: Kehadiran — buka pertama (sinkron penuh) | siswa | 27.994 | 2% |
| Siswa: Beranda (pengumuman) | siswa | 15.552 | 1% |
| Guru: detail kelas (siswa) | guru | 12.960 | 1% |
| Siswa: Nilai | siswa | 9.331 | 1% |
| Guru: pengumpulan satu tugas | guru | 7.920 | 1% |
| Siswa: Jadwal | siswa | 7.776 | 1% |
| Siswa: Kehadiran — buka berikutnya (sinkron jendela 7 hari) | siswa | 4.666 | 0% |

| | Per hari | Per bulan |
|---|---:|---:|
| Bacaan | 1.417.608 | 31.187.376 |
| Tulisan | 1.433 | 31.532 |
| Biaya bacaan (USD) | | 18.71 |
| Biaya tulisan (USD) | | 0.06 |
| **Total Firestore** | | **US$ 18.77 ≈ Rp 300.307** |

Harga yang dipakai: bacaan US$ 0.06/100 ribu, tulisan US$ 0.18/100 ribu, kurs Rp 16.000/US$. Kuota gratis (50.000 bacaan/hari per project) berlaku untuk seluruh project, bukan per sekolah — satu sekolah sebesar ini sudah melampauinya.

## Temuan (alur berat)

- **Guru: Beranda — buka pertama (cache perangkat kosong)**: 2.343 bacaan, 809 KB (sangat berat).
- **Guru: daftar kelas**: 1.296 bacaan, 172 KB (berat).
- **Guru: riwayat presensi satu kelas**: 720 bacaan, 2410 KB (berat).
- **Guru: riwayat jurnal satu kelas**: 720 bacaan, 252 KB (berat).
- **Guru: Analitik**: 10.692 bacaan, 13479 KB (sangat berat).
- **Guru: Jadwal**: 720 bacaan, 96.2 KB (berat).
- **Siswa: Kehadiran — buka pertama (sinkron penuh)**: 720 bacaan, 2410 KB (berat).

