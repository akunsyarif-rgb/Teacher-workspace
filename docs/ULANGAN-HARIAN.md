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
| Isolasi workspace/kelas/guru | RLS `FORCE` pada semua tabel `ulh_*`; SELECT hanya untuk guru pengelola (pembuat atau OWNER/ADMIN); tidak ada policy/grant tulis → tulis hanya lewat RPC |
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

## Dependensi yang belum terpenuhi (blocker aktivasi)
1. PR #59 (RLS hardening/baseline) dan #60 (adapter) belum merge; migrasi ulangan bergantung pada fungsi `private.*` dan `set_updated_at`/`protect_immutable_columns` dari baseline.
2. RPC memakai `teacher_profiles`, `student_profiles`, `students` **di Supabase**. Selama koleksi itu masih di Firestore (flag migrasi mati), guru/siswa tidak dikenali di Supabase dan semua RPC menolak (42501). Jadi modul baru berguna setelah unit identitas dimigrasi/disinkronkan (lihat `docs/CUTOVER-SUPABASE.md`).
3. Auth siswa anonim ke Supabase belum terbukti (`scripts/supabase/verify-auth.mjs` di staging).

## Yang diuji
- `tests/ulangan-harian.test.ts` (17 tes, Postgres lokal + stub auth): lintas workspace/guru/kelas, tulis langsung ditolak, kebocoran kunci, skor/waktu, submit ganda, autosave, integritas, audit.
- `tests/ulangan-client.test.ts` (9 tes, adapter palsu): payload tanpa identitas/skor/waktu, ambang 3 dtk, validasi.
- `tests/rls-parity.test.ts`, `rls-migration.test.ts`: tetap lulus dengan migrasi baru.
- Jalankan: `RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres npx vitest run tests/ulangan-harian.test.ts tests/ulangan-client.test.ts`
- **Belum** diuji di Supabase nyata (Postgres lokal ≠ PostgREST/GoTrue/JWT Supabase), belum diuji beban, belum diuji browser/e2e.

## Penerapan (hanya setelah persetujuan eksplisit)
1. Merge #59/#60 (atau branch ini beserta keduanya) → 2. terapkan `supabase/migrations/20261010000000_ulangan_harian.sql` ke **staging/branch Supabase dulu** →
3. `get_advisors` (security) + ulangi tes RLS terhadap staging → 4. isi `teacher_profiles/student_profiles/students` staging → 5. set `NEXT_PUBLIC_ULANGAN_ENABLED=yes` hanya di Preview.
Rollback: `supabase/rollback/20261010000000_ulangan_harian_down.sql` (menghapus semua data ulangan).

## Di luar MVP / catatan
Remedial, bank soal lintas paket, soal esai/gambar, ekspor, realtime monitor (saat ini polling 15 dtk), proktor. Edit ujian terbit sengaja dikunci.
Pembatasan: kelas dikenali dari `class_name` teks (tidak ada tabel kelas), jadi mengganti nama kelas setelah ujian dibuat tidak otomatis mengikuti.
