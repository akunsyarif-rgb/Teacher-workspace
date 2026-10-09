# Runbook: `session_skip_reasons` Firestore → Supabase (koleksi percobaan)

**Status: jalur kode SIAP untuk 5 koleksi, flag default MATI.** Satu-satunya penghalang yang tersisa adalah yang tidak bisa saya kerjakan sendiri:
auth Firebase→Supabase (Third-Party Auth + claim `role`) dan staging. Koleksi siap (`OFFLINE_PARITY_READY`, 7): `session_skip_reasons`, `academic_years`, `class_fund_transactions`, `class_inventory`,
`student_notes`, `schedules`, `grade_columns` — repository-nya sudah memakai `adapterFor(koleksi)`.

## Gerbang aktivasi (kode, bukan sekadar dokumen)
`isSupabaseCollection(c)` benar hanya bila `NEXT_PUBLIC_SUPABASE_COLLECTIONS` memuat `c` **dan** (`c` ∈ `OFFLINE_PARITY_READY`
**atau** `NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE=yes`). Menyalakan = set env itu di Vercel (Preview dulu). Jangan di Production sebelum auth+staging+backfill terbukti.
Teruji di `tests/data-backend.test.ts` dan `tests/session-skip-reason-repository.test.ts`.

## Kesetaraan adapter (supabaseAdapter vs firestoreAdapter)
| Fungsi | Firestore | Supabase (tes: `tests/supabase-adapter.test.ts`) |
|---|---|---|
| `getDocuments` | semua hasil | paginasi eksplisit (tidak terpotong batas 1000 baris), wajib filter `workspaceId`, hanya operator `==` |
| `getDocument` | `{id,...data}`/null | sama; baris tenant lain = null (RLS) |
| `getDocumentFromCache` | cache lokal | selalu `null` (tak ada cache) |
| `countDocuments` | aggregation | `count=exact` |
| `addDocument` | `{id,...data}` + `createdAt` server | sama; `created_at` default DB; wajib `workspaceId`; 2xx tanpa baris = error |
| `updateDocument` | gagal bila tak ada | sama (`not_found`); `workspaceId` immutable; compare-and-swap `updated_at` (3 percobaan) → `conflict` |
| `setDocument` (merge) | upsert | baca→update atau insert; bentrok insert→update |
| `deleteDocument` | tak ada = sukses | sama; 0 baris karena RLS = error `denied` (bukan sukses palsu) |
| `batchWrite` | atomik ≤500 | **ditolak tegas** (butuh RPC transaksional) → koleksi yang memakai batch belum boleh dialihkan |
| Error | `FirebaseError` | `SupabaseAdapterError{kind: offline/network/timeout/auth/denied/conflict/not_found/bad_request/server}` |
| Retry | SDK | hanya GET (network/timeout/5xx, 2×); tulis TIDAK diulang; 401 → refresh token 1× |
| Antrean offline | ya | **tidak** — `offline` dilempar tanpa memanggil jaringan |

Perbedaan data yang disengaja: `createdAt/updatedAt` string ISO (bukan `Timestamp`); kolom `null` dihilangkan; field tak berkolom
(mis. `scheduleId`, `note`) ada di `metadata` jsonb dan difilter lewat `metadata->>field` (tanpa indeks).
Tidak ada fallback ke Firestore saat Supabase gagal (diuji): kegagalan merambat ke UI.

## Offline — bukti dan padanannya (lapisan offline sudah dibangun)
Kontrak offline di kode: cache IndexedDB persisten Firestore, `OfflineBanner`, label "tersimpan offline" di tab Presensi/Jurnal/Nilai,
dan Beranda yang tetap termuat dari cache. Padanan untuk Supabase: `lib/adapters/offlineLayer.ts` (dibungkus di `supabaseClient.ts`):
- **Cache baca** per query (IndexedDB, dipisah per `uid`): online → server + simpan cache; offline/jaringan putus/timeout → cache;
  tidak pernah dimuat → error jujur. Error lain (auth/denied/...) tidak pernah disamarkan dengan cache.
- **Outbox tulis** FIFO: hanya kegagalan jaringan yang menjadi "sukses semu"; id dibuat di klien, replay = `set` buat-atau-gabung (idempoten,
  aman bila POST sebenarnya sudah sampai server). Dokumen yang punya antrean memaksa tulisan berikutnya ikut antre (urutan terjaga).
  "Read your own writes": hasil baca ditimpa operasi yang belum terkirim.
- **Flush** otomatis saat `online`, saat dimuat, tiap 30 dtk, dan sebelum tiap baca. Gagal jaringan/auth/5xx/konflik → berhenti & coba lagi;
  gagal permanen → *dead letter* (`listFailed()`), tidak hilang diam-diam. `getStatus()/subscribe()` untuk indikator UI.
- Beranda: sumber sekunder (alasan skip) kini `catch` → `[]` + `console.warn`, sehingga satu sumber gagal tidak mematikan ringkasan.
- Batas yang diketahui: satu tab (sama seperti `persistentSingleTabManager`); IndexedDB tidak tersedia → memori (outbox tak bertahan);
  Safari: sama seperti Firestore (lihat `browserSupport.ts`); implementasi IndexedDB mentah belum diuji di browser sungguhan
  (logika diuji dengan store memori) — uji e2e Playwright `setOffline` ditambahkan saat ada staging Supabase.
Tes: `tests/offline-layer.test.ts` (13): cache, offline, POST hilang di tengah jalan, urutan add→update→delete, dead letter, jaringan putus saat flush.

## Backfill + rekonsiliasi (`scripts/migration/backfill-collection.ts`)
```bash
npm run migrate:collection -- --collection session_skip_reasons --workspace <wsId>            # dry-run (default): hanya GET
npm run migrate:collection -- --collection session_skip_reasons --workspace <wsId> --apply    # upsert idempoten per id, lalu rekonsiliasi
```
Env: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ALLOWED_REFS` (wajib; kosong = tolak semua), `FIREBASE_SERVICE_ACCOUNT`.
Dijalankan lewat `jiti` yang sudah terpasang oleh `npm ci` (tanpa unduhan). Guard: `--workspace` wajib; SmadaExam selalu ditolak;
Workflow produksi butuh `ALLOW_PRODUCTION_BACKFILL=yes` (jangan dipakai tanpa persetujuan). Exit: 0 bersih · 1 gagal parsial/kotor · 2 konfigurasi ditolak.
Rekonsiliasi membandingkan kolom + `metadata` (bukan timestamp), melaporkan hilang/berlebih/beda/duplikat/dokumen tak valid, **tidak pernah menghapus**.
Bukti: `tests/backfill-cli.test.ts` menjalankan CLI sungguhan (proses) terhadap Firestore emulator + Supabase palsu — dry-run hanya GET,
apply mempertahankan id & timestamp, ulang tidak menggandakan, kegagalan parsial exit 1 lalu pulih, target terlarang exit 2 tanpa request.
Belum pernah dijalankan terhadap Supabase nyata.

## Urutan saat prasyarat terpenuhi
1. Auth terbukti (PR #59 bagian 7) + staging tersedia + migrasi #59 terpasang di staging.
2. Staging: dry-run → `--apply` → dry-run harus `ok` (exit 0).
3. Offline parity (di atas) selesai & disetujui → isi `OFFLINE_PARITY_READY`; uji di Preview dengan flag.
4. Produksi: persetujuan eksplisit, backup, satu workspace dulu. Tanpa dual-write: selama flag aktif Supabase sumber kebenaran koleksi ini.

## Rollback
Matikan flag → Firestore kembali dipakai. Tulisan yang terjadi saat flag aktif hanya ada di Supabase: jalankan rekonsiliasi dibalik
(Supabase→Firestore) sebelum rollback bila perlu. Backfill hanya menambah/menimpa baris Supabase; Firestore tak diubah.

## Koleksi (status)
Sudah dialihkan di kode (flag mati): tujuh koleksi di atas. Dampak lintas-modul yang sudah ditangani:
- **Rename kelas** (`/api/classes/rename`, Admin SDK hanya mengubah Firestore): `renameClassInSupabase` (server, secret key, dibatasi workspace+kelas lama)
  ikut mengganti `class_name` di koleksi berflag; gagal → error yang menyebut apa yang sudah berubah. Teruji (`tests/supabase-class-rename.test.ts`).
- **Urutan kolom nilai** memakai `createdAt`: `toMillis` kini menerima string ISO (Supabase) — tanpa ini urutan kolom acak.
- **Beranda**: alasan skip gagal tidak mematikan ringkasan.
Belum bisa dialihkan (alasan konkret):
- `journals`, `attendances`, `announcements`, `assignments`, `submissions`: disentuh langsung oleh Arsip/Cleanup/Export berbasis Firestore
  (`dataLifecycleCollections`, `dataArchiveRepository`, `dataCleanupRepository` memakai `batchWrite`/range query) → butuh operator range
  + RPC batch transaksional + routing lapisan itu sebelum aman.
- `students`, `grades`, `student_achievements`, `student_login_codes`, `student_profiles`: `batchWrite` / klaim akses siswa (butuh RPC `claim_student_profile` + auth siswa anonim terbukti).
Urutan berikutnya: RPC `batch_write` (migrasi, PR #59) → students/grades/achievements; lalu range operator + routing Arsip/Cleanup → journals/attendances/announcements/assignments; terakhir submissions.
