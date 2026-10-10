# Ulangan Harian (Supabase) — status, desain, dan langkah manual

Status: **kode selesai + tes lokal lulus. BELUM diterapkan ke Supabase Workflow. BELUM aktif di produksi.**
Branch: `feat/ulangan-harian-supabase` (dasar: PR #60 + PR #59 digabung; keduanya masih open saat ditulis).

## Batas yang ditegakkan
- Data ujian hanya di Supabase (tabel `ulh_*`); tidak ada Firestore. Tidak menyentuh project Supabase SmadaExam.
- Modul tersembunyi kecuali `NEXT_PUBLIC_ULANGAN_ENABLED=yes` (hanya menyembunyikan UI; keamanan ada di RLS/RPC).
- Tidak ada service-role/secret key di klien. Semua RPC dipanggil dengan token pengguna (Firebase → Supabase).

## Model keamanan
| Hal | Penegakan |
|---|---|
| Isolasi workspace/kelas/guru | RLS aktif pada semua tabel `ulh_*`; SELECT hanya untuk guru pengelola (pembuat atau OWNER/ADMIN); tidak ada policy/grant tulis → tulis hanya lewat RPC |
| Siswa | Tanpa grant/policy pada tabel; hanya 6 RPC (`ulh_list_my_exams`, `start_attempt`, `get_attempt`, `save_answer`, `submit_attempt`, `report_integrity_event`). Identitas dari `student_profiles` via `sub` JWT; kelas/workspace dari server |
| Kunci jawaban | Tabel `ulh_question_keys` terpisah; dibaca hanya oleh guru pengelola dan fungsi penilaian private; payload soal siswa tanpa kunci |
| Timer | `expires_at = least(mulai + durasi, closes_at)` dari `clock_timestamp()` server; `save_answer` setelah batas ditolak; `submit` setelah batas menutup sebagai `expired` dengan jawaban yang tersimpan sebelum batas |
| Idempotensi | `unique(exam_id, student_id)` + `on conflict`; submit ulang mengembalikan hasil sama; autosave memakai `client_seq` monoton; event integritas `unique(attempt_id, client_event_id)` |
| Skor | Dihitung di `private.ulh_finalize`; tidak pernah dari klien |
| Audit | `ulh_audit_log` (paket/ujian dibuat, diubah, dihapus, terbit, ditutup); hanya terbaca OWNER/ADMIN; tidak bisa ditulis klien |
| Integritas | Jeda keluar halaman > 3 dtk dicatat; peringatan bertingkat 1/2/3 ditentukan server; **tidak ada sanksi otomatis**; UI guru memberi catatan bahwa sinyal hanyalah indikasi |

## Dari SmadaExam (smadaexam-app) — yang dipakai ulang
Hanya **pola**, ditulis ulang (skema identitas berbeda: SmadaExam `auth.uid()` uuid; TW `sub` Firebase teks + `student_profiles`):
`start_attempt`/`save_answer`/`submit_attempt`/`report_security_event`, kunci terpisah, blueprint acak per attempt, rate-limit event,
`useSecurityMonitor` (episode keluar halaman). Perbedaan sengaja: ambang 1 dtk → 3 dtk, tidak ada proktor/perangkat tunggal/realtime.
Repo `SmadaExam` (huruf besar) hanya berisi README kosong; yang nyata adalah `smadaexam-app`.

## Identitas guru & siswa (blocker 1 — diselesaikan di kode, belum terbukti di Supabase nyata)
Masalah: RPC perlu tahu siapa pemanggil, tetapi `teacher_profiles/student_profiles/students` di Workflow masih **0 baris** (migrasi
Firestore→Supabase ditahan; kebenaran identitas ada di Firestore). Mengisi tabel identitas asli lebih awal akan menimbulkan sumber
kebenaran ganda dan hak basi; membuat baris "demi lulus tes" dilarang.

Solusi (memakai `sub` JWT = uid Firebase, `user_id text`, bentuk mirip `student_profiles`):
- Tabel proyeksi khusus modul **`ulh_members`** (user_id → kind/workspace/peran/siswa/kelas) dan **`ulh_roster`** (daftar siswa per workspace).
  RLS aktif **tanpa policy dan tanpa grant** untuk `anon`/`authenticated` → hanya `service_role` yang bisa menulis/membaca.
- Ditulis HANYA oleh `POST /api/ulangan/sync-identity` (server): memverifikasi ID token Firebase (`checkRevoked`), uid hanya dari token,
  lalu membaca **kebenaran di Firestore** (`teacher_profiles`, `student_profiles` + pencocokan dokumen `students`). Tidak valid/tidak ada → baris dicabut.
- **TTL fail-closed** di RPC: proyeksi guru 30 menit, siswa 6 jam. Jika sinkronisasi berhenti, akses berhenti. Siswa yang **sudah mulai**
  tetap bisa menjawab/mengumpulkan (kepemilikan = `ulh_attempts.user_id` = uid JWT), jadi TTL tidak memutus ujian di tengah jalan.
- Klien memicu sinkronisasi saat halaman guru dibuka dan otomatis sekali saat RPC menjawab `not_a_teacher`/`not_a_student`/`class_not_found`.
- Setelah cutover penuh: ganti isi `private.ulh_teacher_ctx/ulh_student_ctx/ulh_manages_*` ke tabel identitas asli lalu hapus proyeksi.
- Env server (Preview dulu): `ENABLE_ULANGAN_IDENTITY_SYNC=yes`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (service role, **server-only**),
  `FIREBASE_ADMIN_SERVICE_ACCOUNT`; klien: `NEXT_PUBLIC_ULANGAN_ENABLED=yes`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  dan jalur claim role (`ENABLE_SUPABASE_CLAIM=yes`) yang sudah ada. Target `abdkrhmxfpcmgzsxzfyz` (SmadaExam) ditolak oleh `serviceRequest`.
- Risiko sisa: guru yang dikeluarkan di Firestore masih berhak maksimal 30 menit (atau sampai sinkronisasi berikutnya dari akunnya sendiri);
  roster baru ikut saat guru membuka halaman (maks. 1× per 15 dtk per instance).

## Audit 17 RPC (hasil + perbaikan)
Diperiksa lewat katalog (tes `audit grants/definer/search_path/kunci jawaban`) dan baca kode:
- EXECUTE: semua `public.ulh_*` → hanya `authenticated` (bukan `anon`, bukan PUBLIC). Helper `private.ulh_*` tertutup kecuali 4 helper yang dipakai policy RLS.
- Semua `SECURITY DEFINER` dengan `search_path = ''`; objek selalu dikualifikasi skema.
- Setiap RPC memeriksa identitas dari JWT (`private.current_uid()`); RPC siswa atas attempt memeriksa `ulh_attempts.user_id = uid`; RPC guru memeriksa pengelola paket/ujian (pembuat atau OWNER/ADMIN) dan workspace.
- Kunci jawaban (`ulh_question_keys`) hanya disentuh `ulh_save_package`, `ulh_get_package` (guru pengelola) dan `private.ulh_finalize` (penilaian).
- Diperbaiki pada audit ini: (1) `ulh_publish_exam` mengunci baris paket `for share` dan `ulh_delete_package` `for update` agar tidak balapan dengan `ulh_save_package` (paket tidak bisa berubah setelah ujian terbit); (2) RPC attempt tidak lagi bergantung pada keanggotaan segar; (3) rujukan ke tabel identitas asli diganti proyeksi.

## FORCE ROW LEVEL SECURITY
Terverifikasi **read-only** di Workflow (2026-10-10): role `postgres` = NOSUPERUSER **BYPASSRLS=true**, memiliki semua tabel & fungsi `public/private`;
`anon`/`authenticated` NOBYPASSRLS; `relforcerowsecurity=false` pada tabel yang ada; tidak ada default ACL di skema `public`.
Kesimpulan: tanpa FORCE aman (pemilik melewati RLS, klien tidak pernah pemilik). Dengan FORCE pada pemilik tanpa BYPASSRLS, RPC definer akan gagal
(dibuktikan tes lokal `FORCE RLS vs kepemilikan`). Maka FORCE sengaja tidak dipakai.

## Yang diuji (lokal — BUKAN Supabase nyata)
- `tests/ulangan-harian.test.ts`: dijalankan 3× — superuser, pemilik NOSUPERUSER BYPASSRLS (setara `postgres` Supabase), pemilik NOSUPERUSER NOBYPASSRLS; plus audit katalog, TTL/pencabutan identitas, klien tak bisa memalsukan `ulh_members`, bukti FORCE RLS. (65 tes)
- `tests/ulangan-identity.test.ts`: sinkronisasi (Firestore/Supabase palsu), route handler (501/401/uid dari token saja/502), klien, `withIdentity`. (11 tes)
- `tests/ulangan-client.test.ts` (9), `rls-parity`, `rls-migration`, `data-backend`, `supabase-adapter` tetap lulus (total 695 pada gabungan ini).
- Jalankan: `RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-*.test.ts`
- **Belum** diuji di Supabase nyata: PostgREST + validasi JWT Firebase, advisor keamanan, `ulh_*` tidak ada di Workflow (0 tabel), alur browser/e2e, beban.

## Blocker tersisa
1. PR #59/#60 belum merge (migrasi ulangan memakai `private.protect_immutable_columns`, `public.set_updated_at` dari baseline; #59 menurut judulnya sudah diterapkan ke Workflow).
2. Migrasi ulangan belum diterapkan ke staging/Workflow (butuh persetujuan).
3. Sinkronisasi identitas belum pernah dijalankan terhadap Firestore + Supabase nyata.
4. Token siswa anonim ke Supabase: tercatat terbukti di Preview (`docs/STATUS-MIGRASI.md`), belum saya verifikasi ulang.

## Penerapan (hanya setelah persetujuan eksplisit)
1. Persetujuan eksplisit → terapkan `supabase/migrations/20261010000000_ulangan_harian.sql` ke **staging/branch Supabase dulu** (bukan Workflow langsung) →
2. `get_advisors` (security) + tes RLS terhadap staging → 3. env Preview di atas → 4. buka `/ulangan` sebagai guru uji (memicu sinkronisasi) lalu `/student/ulangan` sebagai siswa uji → 5. alur lengkap guru–siswa.
Rollback: `supabase/rollback/20261010000000_ulangan_harian_down.sql` (menghapus semua data ulangan).

## Di luar MVP / catatan
Remedial, bank soal lintas paket, soal esai/gambar, ekspor, realtime monitor (saat ini polling 15 dtk), proktor. Edit ujian terbit sengaja dikunci.
Pembatasan: kelas dikenali dari `class_name` teks (tidak ada tabel kelas), jadi mengganti nama kelas setelah ujian dibuat tidak otomatis mengikuti.
