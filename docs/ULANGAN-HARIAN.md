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

## Audit pra-staging (2026-10-10)
**Migrasi & rollback** — hasil audit kode DAN bukti tes lokal (`tests/ulangan-migration.test.ts`, Postgres lokal berisi baseline + migrasi PR #59):
- Diff katalog sebelum/sesudah: migrasi hanya MENAMBAH objek ber-nama `ulh_*`; tidak ada tabel/fungsi/policy/trigger/ACL/ekstensi lain yang berubah atau hilang. Tidak menyentuh `storage`, `auth`, cron, ekstensi, skema, role.
- **Temuan & perbaikan:** migrasi memuat `revoke all on all sequences in schema public from anon` yang mencabut hak sequence tabel LAIN (terbukti pada sequence uji). Dihapus; yang tersisa hanya revoke sequence milik modul. (Di Workflow saat ini tidak ada sequence di `public`, jadi dampak nyata nol — tetapi pernyataan global berbahaya untuk migrasi mendatang.)
- Rollback: katalog kembali PERSIS seperti sebelum migrasi; aman dijalankan dua kali; migrasi bisa diterapkan ulang. Isi rollback hanya `drop ... if exists` objek `ulh_*` (diuji teks); ia menghapus SEMUA data ulangan.
- Penerapan kedua gagal tanpa mengubah apa pun (tidak diam-diam menimpa). Dependensi di luar modul hanya `private.current_uid`, `private.protect_immutable_columns`, `public.set_updated_at`, `auth.jwt`, `auth.role` — **terverifikasi ada di Workflow** (query katalog read-only), dimiliki `postgres`.

**Endpoint `POST /api/ulangan/sync-identity`** — temuan dari membaca kode, perbaikan, dan tes (`tests/ulangan-identity.test.ts`):
| Temuan | Perbaikan |
|---|---|
| Pembatas laju hanya untuk roster, in-memory tanpa batas ukuran; akun anonim Firebase bisa dibuat siapa saja → banjir bisa memicu baca Firestore + tulis Supabase tanpa batas | `lib/server/ulanganRateLimit.ts`: per-uid 5 dtk (roster 15 dtk), global 240/menit/instance (429 + `Retry-After`), memori dibatasi 5000 kunci |
| `verifyIdToken(checkRevoked=true)` (panggilan jaringan) dijalankan sebelum pembatas | Urutan baru: tanda tangan (lokal) → pembatas → cek pencabutan → Firestore → tulis |
| Sink service_role menerima nama tabel/filter bebas | `lib/server/ulanganIdentitySink.ts`: hanya `ulh_members`/`ulh_roster`, kolom konflik tetap, filter hapus berbentuk tertutup (tidak ada hapus massal), maks 500 baris/permintaan |
| Pencabutan hanya lewat TTL atau saat pengguna memanggil sync | Mengeluarkan guru (`removeWorkspaceMemberServer`) kini langsung mencabut baris `ulh_members` (no-op bila fitur mati; best-effort, TTL tetap jaring pengaman) |
| Profil guru Firestore dipercaya apa adanya | Pertahanan berlapis: dokumen `workspaces/{id}` harus ada, dan OWNER harus sama dengan `ownerUid` workspace |
| Body tak dibatasi | Maks 1 KB (413) |
Sumber role/workspace/kelas tetap Firestore (dilindungi `firestore.rules`), uid hanya dari token, siswa dicocokkan dengan dokumen `students`. Secret key hanya dipakai di `lib/server/*` yang hanya diimpor route handler (tidak ada impor dari komponen klien).
Batas yang TIDAK bisa ditutup di kode ini: pembatas laju per instance serverless bukan pagar lintas-instance; untuk itu pakai Vercel Firewall / Firebase App Check (tindakan manual).

## Pengujian terisolasi: apakah Supabase Free yang ada bisa dipakai?
Fakta (read-only, 2026-10-10): organisasi `Conan` plan **Free** dengan 2 project aktif (`Workflow`, `SmadaExam`) = batas 2 project Free. Branching = fitur **Pro (berbayar)**; `Workflow` hanya punya branch default `main`.
- Project ketiga tidak bisa dibuat di Free tanpa menjeda salah satu project (SmadaExam dilarang disentuh) — **tidak dilakukan**. Branch/preview env = berbayar — **tidak dilakukan**.
- Jadi lingkungan **cloud** terisolasi gratis **tidak tersedia** tanpa keputusan Anda. Pengganti gratis yang SUDAH ada: Postgres 16 lokal/CI + PostgREST resmi (`tests/ulangan-postgrest.test.ts`) dan workflow `.github/workflows/ulangan-db-tests.yml` (jalankan manual dari tab Actions; tanpa secret, tanpa Supabase).
- Opsi cloud: (a) setujui penerapan langsung ke Workflow — migrasi bersifat aditif murni (terbukti diff katalog) dan punya rollback teruji, tabel identitas masih kosong, jadi risiko data nol; tetap perlu persetujuan eksplisit; (b) kosongkan satu slot project milik Anda sendiri untuk staging; (c) upgrade Pro (berbayar).

## Yang diuji (lokal — BUKAN Supabase nyata)
- `ulangan-harian` (65): RLS/RPC pada 3 mode pemilik, audit katalog, TTL/pencabutan, FORCE RLS.
- `ulangan-migration` (5): diff katalog, rollback, penerapan ganda, teks, dependensi.
- `ulangan-postgrest` (6): **PostgREST nyata v12.2.3 + adapter & repository asli** lewat HTTP — alur guru→siswa→skor, tulis langsung ditolak 403, JWT salah/kedaluwarsa/palsu ditolak, hanya 17 RPC publik terekspos, galat nyata cocok dengan `withIdentity`, lintas workspace. Butuh `POSTGREST_BIN` (biner resmi; sha256 `9f71269e…27c`).
- `ulangan-identity` (21), `ulangan-client` (9), `workspace-server-supabase`, `rls-parity`, `rls-migration`, `data-backend`, `supabase-adapter`: total 731 lulus pada gabungan ini.
- Jalankan: `POSTGREST_BIN=... RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-*.test.ts`
- **Belum** diuji di Supabase nyata: gateway/Third-Party Auth Firebase (JWKS), `get_advisors`, pembatas platform, `ulh_*` belum ada di Workflow, alur browser/e2e, beban. Workflow CI di atas belum pernah dijalankan.

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
