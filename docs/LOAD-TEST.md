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
| Guru: Beranda (ringkasan hari ini) | guru | 3.483 | 9 | 2970 | 1301 | 16.2 | sangat berat |
| Guru: daftar kelas | guru | 1.296 | 3 | 172 | 177 | 0.9 | berat |
| Guru: detail kelas (siswa) | guru | 36 | 1 | 4.7 | 33 | 0.0 |  |
| Guru: riwayat presensi satu kelas | guru | 720 | 1 | 2410 | 528 | 13.2 | berat |
| Guru: riwayat jurnal satu kelas | guru | 720 | 1 | 252 | 337 | 1.4 | berat |
| Guru: tabel nilai kelas | guru | 444 | 2 | 51.8 | 207 | 0.3 |  |
| Guru: pengumpulan satu tugas | guru | 66 | 2 | 22.5 | 262 | 0.1 |  |
| Guru: Analitik | guru | 10.692 | 10 | 13479 | 24766 | 73.6 | sangat berat |
| Guru: Jadwal | guru | 720 | 2 | 96.2 | 113 | 0.5 | berat |
| Siswa: buka Student Companion | siswa | 821 | 8 | 2435 | 1137 | 13.3 | berat |

## Estimasi bulanan untuk satu sekolah

Asumsi: 60 guru, 1296 siswa (60% aktif per hari sekolah), 22 hari sekolah/bulan.

| Alur | Pelaku | Bacaan/hari | Porsi |
|---|---|---:|---:|
| Guru: Beranda (ringkasan hari ini) | guru | 1.671.840 | 42% |
| Siswa: buka Student Companion | siswa | 1.276.819 | 32% |
| Guru: Analitik | guru | 320.760 | 8% |
| Guru: daftar kelas | guru | 233.280 | 6% |
| Guru: riwayat presensi satu kelas | guru | 172.800 | 4% |
| Guru: riwayat jurnal satu kelas | guru | 129.600 | 3% |
| Guru: Jadwal | guru | 86.400 | 2% |
| Guru: tabel nilai kelas | guru | 79.920 | 2% |
| Guru: detail kelas (siswa) | guru | 12.960 | 0% |
| Guru: pengumpulan satu tugas | guru | 7.920 | 0% |

| | Per hari | Per bulan |
|---|---:|---:|
| Bacaan | 3.992.299 | 87.830.582 |
| Tulisan | 1.433 | 31.532 |
| Biaya bacaan (USD) | | 52.70 |
| Biaya tulisan (USD) | | 0.06 |
| **Total Firestore** | | **US$ 52.76 ≈ Rp 844.082** |

Harga yang dipakai: bacaan US$ 0.06/100 ribu, tulisan US$ 0.18/100 ribu, kurs Rp 16.000/US$. Kuota gratis (50.000 bacaan/hari per project) berlaku untuk seluruh project, bukan per sekolah — satu sekolah sebesar ini sudah melampauinya.

## Temuan (alur berat)

- **Guru: Beranda (ringkasan hari ini)**: 3.483 bacaan, 2970 KB (sangat berat).
- **Guru: daftar kelas**: 1.296 bacaan, 172 KB (berat).
- **Guru: riwayat presensi satu kelas**: 720 bacaan, 2410 KB (berat).
- **Guru: riwayat jurnal satu kelas**: 720 bacaan, 252 KB (berat).
- **Guru: Analitik**: 10.692 bacaan, 13479 KB (sangat berat).
- **Guru: Jadwal**: 720 bacaan, 96.2 KB (berat).
- **Siswa: buka Student Companion**: 821 bacaan, 2435 KB (berat).

