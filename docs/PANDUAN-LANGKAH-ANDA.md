# Panduan Langkah yang Perlu Anda Kerjakan

Empat hal yang tidak bisa dikerjakan dari sisi kode dan butuh keputusan atau
akses Anda. Urut dari yang paling mendesak.

| # | Langkah | Wajib? | Perkiraan waktu |
|---|---------|--------|-----------------|
| 1 | Aktifkan Firebase Storage | Ya, kalau ingin upload lampiran jalan | 5 menit |
| 2 | Buat ulang kode akses siswa lama | Hanya kalau sudah terlanjur ada siswa | 2 menit |
| 3 | Merge branch ke `main` | Ya, untuk merilis | 10 menit |
| 4 | Siapkan API key untuk AI Copilot | Tidak — fitur belum dibangun | 15 menit + keputusan biaya |

Sebelum semuanya, disarankan: **coba dulu sendiri**.

```bash
npm run emulators     # terminal 1
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true npm run dev   # terminal 2
```

Uji otomatis membuktikan alurnya jalan, tapi tidak bisa menilai apakah rasanya
enak dipakai. Itu penilaian yang hanya bisa Anda buat.

---

## 1. Aktifkan Firebase Storage

**Kenapa perlu:** lampiran tugas siswa disimpan di Firebase Storage. Kalau
bucket-nya belum pernah dibuat, deploy `storage.rules` akan gagal dan fitur
unggah lampiran mati — walau kodenya sudah siap.

**Cara:**

1. Buka [Firebase Console](https://console.firebase.google.com) → pilih project
   Teacher Workspace
2. Menu kiri → **Build → Storage** → klik **Get started**
3. Pilih **Start in production mode** (aturannya akan ditimpa oleh
   `storage.rules` dari repo ini saat deploy — jangan menempel aturan manual di
   sini)
4. Pilih lokasi bucket. **Samakan dengan lokasi Firestore** Anda (cek di
   Firestore → Settings). Lokasi tidak bisa diubah setelah dibuat.

**Cara memastikan berhasil:** setelah merge ke `main`, buka tab **Actions** di
GitHub → workflow **Deploy Firestore & Storage Rules** harus hijau. Kalau merah
dengan pesan soal bucket, berarti langkah ini terlewat.

---

## 2. Buat ulang kode akses siswa lama

**Lewati langkah ini kalau Anda belum pernah menambahkan siswa.**

**Kenapa perlu:** alur klaim kode akses sempat rusak dan sudah diperbaiki. Kode
akses yang dibuat *sebelum* perbaikan itu tidak memuat data yang dibutuhkan,
sehingga siswa tidak bisa masuk memakainya.

Siswa yang mencoba memakai kode lama akan melihat pesan yang jelas — *"Kode
akses ini dibuat versi lama. Minta gurumu membuat ulang kode akses."* — bukan
gagal tanpa penjelasan. Jadi ini tidak mendesak, tapi lebih baik dibereskan
sebelum siswa mencoba.

**Cara:** hapus siswa yang terdampak di halaman **Siswa**, lalu tambahkan
kembali. Kode akses baru terbuat otomatis dan langsung tampil di detail kelas.

Tidak ada cara memperbaiki kode lama tanpa membuat ulang — datanya memang tidak
pernah tersimpan.

---

## 3. Merge branch ke `main`

Semua pekerjaan ada di branch `claude/teacher-student-ai-ecosystem-j5na1k`.

**Sebelum merge, pastikan hijau:**

```bash
npm run test:rules    # aturan keamanan + logika perhitungan
npm run test:e2e      # alur guru <-> siswa di browser
npm run build         # build produksi
```

**Yang terjadi otomatis setelah merge ke `main`:** GitHub Actions men-deploy
`firestore.rules`, `firestore.indexes.json`, dan `storage.rules`. Pastikan
langkah 1 sudah selesai lebih dulu, kalau tidak deploy-nya gagal.

**Yang perlu diperhatikan:** urutan kolom nilai di gradebook akan berubah sekali
— dari acak menjadi urut sesuai waktu kolom dibuat, dan sama dengan yang dilihat
siswa. Ini perbaikan, tapi tampilan tabel nilai akan bergeser sekali.

Kalau ingin pull request beserta ringkasan perubahannya, minta saja — saya belum
membuatnya karena Anda belum memintanya.

---

## 4. Siapkan API key untuk AI Copilot

Ini satu-satunya yang **benar-benar memblokir** — fitur AI Copilot belum bisa
dibangun tanpa keputusan Anda soal biaya, dan tanpa API key yang hanya bisa Anda
buat.

### 4a. Pilih model — ini keputusan biaya

Harga per 1 juta token (rujukan: [platform.claude.com/docs/en/pricing](https://platform.claude.com/docs/en/pricing)):

| Model | ID | Input | Output |
|-------|-----|-------|--------|
| Claude Opus 5 | `claude-opus-5` | $5 | $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | $3 | $15 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 |

**Perkiraan biaya untuk kasus Anda.** Satu panggilan Copilot (merangkum temuan
analitik jadi bahasa yang enak dibaca) kira-kira memakai 2.500 token masuk dan
300 token keluar:

| Model | Per panggilan | Per guru per bulan* |
|-------|---------------|---------------------|
| Opus 5 | ~$0,020 | ~$5,00 (±Rp80.000) |
| Sonnet 5 | ~$0,010 | ~$2,50 (±Rp40.000) |
| Haiku 4.5 | ~$0,004 | ~$1,00 (±Rp16.000) |

\* Asumsi 10 panggilan/hari × 25 hari sekolah. Kurs ±Rp16.000 — cek kurs saat
ini. **Angka ini perkiraan saya, bukan tagihan resmi** — pantau pemakaian nyata
di Console setelah beberapa hari.

**Saran saya: mulai dari Haiku 4.5.** Merangkum temuan yang sudah terstruktur
(yang sudah dihasilkan `buildInsights`) bukan tugas berat — AI-nya tidak perlu
menganalisis dari nol, cuma menuliskannya dengan enak. Kalau hasilnya kurang
tajam, naikkan ke Sonnet 5 atau Opus 5; mengganti model cukup satu baris.

Kalau nanti aplikasi ini dipakai banyak guru, biaya ini berlipat sesuai jumlah
pengguna. Itu pertimbangan model bisnis yang perlu Anda putuskan sejak awal —
gratis untuk semua guru berarti Anda menanggung seluruhnya.

### 4b. Buat API key

1. Buka [platform.claude.com](https://platform.claude.com) → daftar/masuk
2. **Settings → API keys** → **Create key**
3. Beri nama yang jelas, mis. `teacher-workspace-produksi`
4. **Salin sekarang** — key hanya ditampilkan sekali
5. **Settings → Billing** → isi saldo. Disarankan pasang **usage limit** supaya
   ada batas atas kalau terjadi sesuatu yang tak terduga.

### 4c. Simpan key dengan benar — bagian paling kritis

> ⚠️ **JANGAN pakai awalan `NEXT_PUBLIC_`.**
>
> Semua variabel Firebase di project ini berawalan `NEXT_PUBLIC_` karena memang
> harus bisa dibaca browser. **API key Anthropic tidak boleh.** Awalan
> `NEXT_PUBLIC_` membuat nilainya ditanam ke dalam JavaScript yang diunduh
> setiap pengunjung — siapa pun bisa membukanya lewat Developer Tools dan
> memakai saldo Anda.

**Di lokal** — tambahkan ke `.env.local` (sudah di-gitignore):

```
ANTHROPIC_API_KEY=sk-ant-...
```

**Di hosting** (Vercel/Firebase Hosting/lainnya) — tambahkan lewat menu
Environment Variables di dashboard hosting, bukan di dalam kode.

**Jangan pernah** menaruh key di dalam berkas yang di-commit. Kalau terlanjur,
segera cabut key itu di Console dan buat yang baru — mencabut lebih aman
daripada menghapus commit.

### 4d. Kenapa harus lewat server

Key hanya boleh dipakai di sisi server. Di Next.js ini artinya **route handler**
— berkas `route.ts` di dalam `app/`, yang berjalan di server dan tidak pernah
dikirim ke browser.

Bentuk kasarnya (saya yang akan menulis versi lengkapnya):

```ts
// app/api/copilot/route.ts  — berjalan di server
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // membaca ANTHROPIC_API_KEY dari env

export async function POST(request: Request) {
  const { insights } = await request.json();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: 'Kamu asisten kerja guru. Rangkum temuan berikut jadi 2-3 kalimat '
      + 'yang menyebut tindakan paling mendesak. Bahasa Indonesia, ringkas.',
    messages: [{ role: 'user', content: JSON.stringify(insights) }],
  });

  return Response.json({ summary: response.content });
}
```

Sisi klien memanggil `/api/copilot`, bukan Anthropic langsung. Key tidak pernah
meninggalkan server.

### 4e. Yang perlu dibicarakan sebelum saya membangunnya

Beberapa hal yang mempengaruhi biaya dan tidak bisa saya putuskan sendiri:

- **Kapan Copilot dipanggil?** Otomatis tiap buka dashboard (mahal, selalu
  segar) atau hanya saat guru menekan tombol (murah, terkendali)? Saya sarankan
  tombol dulu.
- **Perlu di-cache?** Kalau temuannya belum berubah, memakai ringkasan
  sebelumnya bisa memangkas biaya drastis.
- **Batas pemakaian per guru?** Tanpa batas, satu pengguna bisa menghabiskan
  saldo untuk semua.

Beri tahu API key sudah siap dan jawaban tiga hal di atas, dan saya bisa mulai.

**Fondasinya sudah ada:** `buildInsights` di `lib/utils/insights.ts` sudah
menghasilkan temuan terstruktur (siswa perlu perhatian, tugas sepi pengumpulan,
jurnal tertinggal). AI-nya tinggal merangkum — bukan mulai dari nol. Itu juga
alasan Haiku kemungkinan besar sudah cukup.
