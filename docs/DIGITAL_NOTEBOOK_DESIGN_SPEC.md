# Buku Catatan Digital — Design Spec v1.1

Status: arah visual yang disepakati; implementasi awal pada dashboard guru berada di branch `design/digital-notebook-dashboard`. Belum menjadi standar final seluruh aplikasi.

## Prinsip

Teacher Workspace harus terasa seperti buku kerja guru yang hidup di perangkat digital: halaman, garis catatan, indeks, dan penanda sorot yang familiar, tanpa mengorbankan kecepatan kerja, keterbacaan, atau integritas data.

## Keputusan desain

- Karakter visual: seimbang — hangat tetapi tetap profesional.
- Navigasi: adaptif — bottom navigation di mobile, indeks samping di desktop, tablet mengikuti ruang efektif. Implementasi navigasi ditunda sampai struktur rute dan role diverifikasi.
- Layar referensi pertama: dashboard guru.
- Tekstur: terlihat secara halus; jangan digunakan di tabel padat, nilai, atau input sensitif.
- Tema: light-only sampai dark mode didesain dan diuji penuh. `prefers-color-scheme: dark` tidak boleh membalik token dasar secara otomatis sementara komponen masih memakai warna eksplisit terang.

## Token kandidat

| Token | Nilai | Penggunaan |
|---|---|---|
| Paper | `#F7F5EF` | Latar halaman |
| Surface | `#FFFFFF` / `#FFFEF9` | Kartu dan bidang kerja |
| Ink | `#242923` | Teks utama |
| Muted ink | `#5D665E` | Teks sekunder |
| Interaction | `#2F6B4F` | Aksi utama dan navigasi aktif |
| Highlight | `#DDF2A5` | Sorotan terbatas |
| Ruled line | `#D9DED5` | Garis kertas halus |

Token di atas masih kandidat desain; jangan menyebutnya sudah lolos WCAG tanpa pengukuran kontras aktual.

## Tipografi dan bentuk

- Heading halaman 28–32 px; bagian 20–22 px; isi 15–16 px; metadata idealnya tidak di bawah 13 px.
- Spacing berbasis kelipatan 4 px.
- Border tipis 1 px, radius 4–10 px, bayangan minimal.
- State tidak boleh dibedakan hanya dengan warna; gunakan label/ikon/bentuk dan pertahankan fokus keyboard yang terlihat.

## Dashboard

1. Header memuat tanggal, waktu, sapaan, dan konteks guru.
2. Prioritas tindakan hari ini tetap paling menonjol.
3. Jadwal dan status tugas tetap kronologis dan eksplisit.
4. Catatan cepat terasa seperti kertas bergaris, dengan status sinkronisasi yang tetap jelas.
5. Akses ke Pusat Kegiatan Kelas, Jadwal, dan Manajemen Kelas tetap mudah ditemukan.

## Penyempurnaan dashboard — tahap 1

- Header memiliki penanda identitas buku kerja dan hierarki judul yang lebih jelas.
- Kartu prioritas menggunakan hijau sebagai aksen utama, tanpa mengubah urutan atau aturan status workflow.
- Catatan Cepat memakai garis buku, teks minimal 14 px, label sinkronisasi yang terbaca, dan fokus interaksi hijau.
- Warna biru lama pada elemen utama dashboard dikurangi agar aksen hijau konsisten; warna status semantik (peringatan, error, selesai) tetap dibedakan menurut fungsinya.
- Teks metadata yang sebelumnya terlalu kecil diperbesar jika aman untuk layout.
- Perubahan visual tidak mengubah fungsi auto-save, debounce, penanganan offline/error, ataupun target penyimpanan catatan.

## Pemeriksaan kontras awal (pasangan token)

Perhitungan luminans WCAG untuk pasangan warna kandidat yang dipakai pada desain:

| Foreground | Background | Rasio | Hasil untuk teks normal |
|---|---|---:|---|
| `#2F6B4F` | `#FFFFFF` | 6.29:1 | Lulus 4.5:1 |
| `#2F6B4F` | `#FFFEF9` | 6.23:1 | Lulus 4.5:1 |
| `#242923` | `#FFFEF9` | 14.68:1 | Lulus 4.5:1 |
| `#5D665E` | `#FFFEF9` | 5.90:1 | Lulus 4.5:1 |
| `#24563F` | `#FFFFFF` | 8.47:1 | Lulus 4.5:1 |
| `#DDF2A5` | `#24563F` | 6.99:1 | Lulus 4.5:1 |
| `#5D665E` | `#F7F5EF` | 5.46:1 | Lulus 4.5:1 |
| `#2F6B4F` | `#EDF3E8` | 5.57:1 | Lulus 4.5:1 |

Ini pemeriksaan token/pasangan tertentu, bukan audit WCAG seluruh halaman. State semantik, placeholder, teks abu-abu Tailwind, border/focus indicator, ikon, dan kombinasi aktual di setiap komponen masih harus diperiksa secara menyeluruh.

## Batasan dan kriteria penerimaan

- Tidak mengubah aturan workflow, penyimpanan, otorisasi, atau logika nilai dalam pekerjaan visual.
- Tidak mengubah SmadaExam atau mengaktifkan Ulangan Harian.
- Uji layout pada mobile/tablet/desktop dan Safari iOS/iPadOS.
- WCAG 2.2 AA sebagai target: teks normal >= 4.5:1, teks besar >= 3:1, indikator UI yang relevan >= 3:1; verifikasi juga fokus keyboard, zoom, empty/loading/error/offline states.
- Sebelum memperluas ke daftar siswa dan halaman Ulangan, evaluasi kepadatan data serta semua state terlebih dahulu.
- Merge/deploy hanya setelah preview dan tes regresi diperiksa; tidak termasuk dalam implementasi desain ini.
