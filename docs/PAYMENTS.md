# Pembayaran & Paket Berbayar

Fitur upgrade paket pakai Midtrans Snap untuk pembayaran, dan Firebase Admin
SDK di server untuk menerapkan hasilnya ke workspace — field
`plan`/`classLimit`/`seatLimit`/`planExpiresAt` di collection `workspaces`
**dikunci dari client** (lihat `firestore.rules`), jadi cuma bisa diubah
lewat webhook pembayaran ini, tidak bisa diubah manual lewat aplikasi atau
DevTools.

## Alur singkat

1. Guru (harus owner workspace) buka `/upgrade`, pilih paket, klik "Bayar
   Sekarang".
2. Client memanggil `POST /api/payments/create-transaction` (dengan token
   login Firebase) → server menghitung harga dari `lib/config/plans.ts`
   (bukan dari client), buat transaksi Midtrans, catat status `pending` di
   collection `payments`, balas dengan Snap token.
3. Client buka popup pembayaran Midtrans Snap pakai token itu.
4. Setelah pembayaran, Midtrans mengirim notifikasi ke
   `POST /api/payments/webhook` → server verifikasi signature, lalu (kalau
   sukses) update `plan`/`classLimit`/`seatLimit`/`planExpiresAt` workspace
   lewat Firebase Admin SDK.

## Environment variable yang perlu ditambahkan (Vercel)

Project → Settings → Environment Variables:

| Nama | Nilai | Catatan |
|---|---|---|
| `MIDTRANS_SERVER_KEY` | Server Key dari Midtrans Dashboard | **Rahasia** — jangan pernah diawali `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | Client Key dari Midtrans Dashboard | Publik, dipakai Snap.js di browser |
| `MIDTRANS_IS_PRODUCTION` | `false` saat masih sandbox, `true` saat live | Dibaca server (route create-transaction & webhook) |
| `NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION` | Samakan dengan di atas | Dibaca client, menentukan URL Snap.js sandbox vs production |
| `FIREBASE_ADMIN_SERVICE_ACCOUNT` | Seluruh isi JSON service account Firebase | Boleh service account yang sama dengan deploy rules/backup, **tetapi role-nya harus ditambah** — lihat catatan di bawah |

> **Service account-nya butuh izin baca/tulis dokumen.** Admin SDK memang
> mem-bypass Firestore Rules, tapi TIDAK mem-bypass IAM. Service account yang
> hanya dipakai deploy rules atau backup biasanya cuma punya role seperti
> *Firebase Rules Admin* atau *Cloud Datastore Import Export Admin* — keduanya
> tidak mengizinkan membaca/menulis dokumen, sehingga route server (rename
> kelas, join workspace, pembayaran) gagal dengan
> `7 PERMISSION_DENIED: Missing or insufficient permissions.`
>
> Tambahkan role **Cloud Datastore User** (`roles/datastore.user`) di
> [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/iam)
> untuk service account tersebut. Perubahan IAM berlaku dalam ~1 menit dan
> **tidak** perlu redeploy.
>
> Pastikan juga `project_id` di dalam JSON sama dengan project Firebase yang
> dipakai aplikasi (`NEXT_PUBLIC_FIREBASE_PROJECT_ID`) — service account dari
> project lain menghasilkan `PERMISSION_DENIED` yang sama persis.

Ambil Server Key & Client Key dari Midtrans Dashboard → **Settings → Access
Keys** (pastikan toggle environment sesuai — Sandbox saat masih uji coba,
Production saat live).

## Daftarkan URL webhook di Midtrans

Midtrans Dashboard → **Settings → Configuration** → isi **Payment
Notification URL** dengan:

```
https://<domain-produksi-kamu>/api/payments/webhook
```

Tanpa ini, Midtrans tidak akan pernah memberi tahu aplikasi kalau ada
pembayaran yang berhasil — pembayaran akan sukses di sisi Midtrans tapi
paket guru tidak pernah ter-upgrade.

## Menguji di sandbox

1. Pastikan semua environment variable di atas sudah diisi dengan nilai
   **sandbox** (`MIDTRANS_IS_PRODUCTION=false`).
2. Buka `/upgrade` di aplikasi (harus login sebagai owner workspace), pilih
   paket, klik Bayar Sekarang.
3. Di popup Snap, pakai [kartu uji Midtrans](https://docs.midtrans.com/docs/testing-payment-on-sandbox)
   (mis. nomor kartu `4811 1111 1111 1114`, CVV `123`, tanggal kadaluarsa
   bebas asal masa depan) atau metode simulasi lain yang tersedia di mode
   sandbox.
4. Setelah pembayaran "berhasil" di sandbox, cek collection `payments` di
   Firestore Console — statusnya harus berubah dari `pending` ke
   `settled`, dan dokumen `workspaces` terkait harus ter-update
   `plan`/`classLimit`-nya.

## Catatan/keterbatasan versi ini

- "Langganan" bulanan/tahunan **bukan** auto-recurring charge — itu akses
  yang berlaku sampai `planExpiresAt`, guru bayar ulang manual saat mau
  lanjut. Ini pilihan sengaja karena mayoritas metode bayar favorit di
  Indonesia (QRIS, transfer bank, e-wallet) tidak mendukung auto-charge
  lewat Snap tanpa tokenisasi kartu.
- Beli kursi guru tambahan untuk `school_annual` saat ini **menimpa**
  (bukan menambah) `seatLimit` yang lama — owner perlu memasukkan total
  kursi yang diinginkan, bukan jumlah tambahannya saja.
- Belum ada pengingat otomatis (email/notifikasi) menjelang
  `planExpiresAt` habis — masih perlu guru cek sendiri di halaman Profil.
