# Runbook: `session_skip_reasons` Firestore → Supabase (koleksi percobaan)

**Status: kode + tes lokal siap; koleksi TIDAK boleh dialihkan.** Dua penghalang tetap terbuka:
(1) auth Firebase→Supabase belum terbukti, (2) perilaku offline belum punya padanan (bagian Offline).
Semua flag default mati dan `OFFLINE_PARITY_READY` (lib/config/dataBackend.ts) sengaja kosong.

## Gerbang aktivasi (kode, bukan sekadar dokumen)
`isSupabaseCollection(c)` benar hanya bila `NEXT_PUBLIC_SUPABASE_COLLECTIONS` memuat `c` **dan** (`c` ∈ `OFFLINE_PARITY_READY`
**atau** `NEXT_PUBLIC_SUPABASE_STAGING_OVERRIDE=yes`). Override hanya untuk Preview/staging uji — jangan pernah di Production.
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

## Offline — bukti dan keputusan
Bukti kontrak offline di kode saat ini:
- `src/config/firebase.ts`: cache IndexedDB persisten "dasar dukungan offline: baca & tulis tetap berfungsi tanpa koneksi".
- `OfflineBanner` global: "perubahan tetap tersimpan dan akan tersinkron otomatis saat koneksi kembali"; tab Presensi/Jurnal/Nilai
  menampilkan "tersimpan offline"; `lib/utils/browserSupport.ts` mendokumentasikan trade-off Safari (antrean tulis tidak bertahan).
- Beranda memuat `getSkipReasonsByDate` di dalam `Promise.all` ringkasan dashboard (`dashboardService`): bila baca Supabase gagal
  saat offline, **seluruh ringkasan Beranda gagal**, bukan hanya alasan skip. Dengan Firestore, `getDocs` jatuh ke cache.
- Penyimpanan alasan (`SkipReasonModal` → `submitSkipReason`) meng-`await` tulisan; dengan Supabase offline langsung error.
Tidak ada tes khusus offline untuk koleksi ini (hanya e2e submission siswa). Karena kontrak offline berlaku global dan tidak ada
bukti bahwa koleksi ini dikecualikan, **koleksi diperlakukan offline-dependent dan tidak dialihkan**.

Syarat sebelum `OFFLINE_PARITY_READY` boleh diisi (usulan sesuai arsitektur layer yang ada):
1. **Cache baca** di Repository/Adapter (stale-while-revalidate, IndexedDB per `workspaceId`+tanggal) sehingga Beranda tetap termuat offline.
2. **Outbox tulis** di adapter: operasi tulis dicatat (IndexedDB) dengan id klien (UUID) + `Idempotency` lewat upsert `on_conflict=id`,
   dikirim ulang saat online (event `online`), status "tersimpan offline" ditampilkan seperti tab lain; konflik diselesaikan
   last-write-wins per (`scheduleId`,`date`).
3. Dashboard memakai `Promise.allSettled` untuk sumber sekunder (alasan skip) agar satu sumber gagal tidak mematikan Beranda.
4. Tes regresi: putuskan koneksi → simpan → muncul "tersimpan offline" → online → tersinkron tepat sekali (e2e Playwright `context.setOffline`).
Tes regresi yang SUDAH ada untuk keadaan sekarang: offline/jaringan putus/timeout/401/5xx pada adapter dan propagasi error di repository.

## Backfill + rekonsiliasi (`scripts/migration/backfill-skip-reasons.ts`)
```bash
npm run migrate:skip-reasons -- --workspace <wsId>            # dry-run (default): hanya GET
npm run migrate:skip-reasons -- --workspace <wsId> --apply    # upsert idempoten per id, lalu rekonsiliasi
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

## Kandidat koleksi berikutnya (urut risiko, setelah adapter + offline terbukti)
1. `academic_years` — volume sangat kecil (1 dokumen/tahun), hanya dipakai panel Arsip/Unduh/Bersihkan data (layar admin, bukan alur harian), tanpa batch.
2. `class_fund_transactions`, `class_inventory`, `student_notes` — hanya wali kelas, tanpa batch; tapi tulis harian guru → bergantung outbox offline.
3. `announcements` — dibaca siswa (butuh klaim auth siswa anonim terbukti).
4. Terakhir: `students`/`student_achievements` (pakai `batchWrite`), `grades`, `attendances`, `journals`, `schedules`, `submissions` (alur inti, batch, offline kuat).
