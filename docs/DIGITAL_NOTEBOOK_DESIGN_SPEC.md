# Teacher Workspace — Digital Notebook Redesign v2.0

Status: implementation scope for PR `design/teacher-workspace-redesign`. This document is the source of truth for the unified redesign. Visual work only; do not alter business logic, data contracts, schema, authorization, grade calculations, attendance rules, or SmadaExam.

## Product direction
Teacher Workspace should feel like a living digital teacher's workbook: warm paper surfaces, readable ink, subtle ruled notes, clear index/navigation, restrained highlighter accents, and efficient classroom workflows. The interface remains intentionally light until a complete dark theme can be designed and tested.

## Scope — one coordinated PR
- Dashboard / Beranda: consistent surfaces and actions; quick note ruled lines must align with text for every line including after repeated Enter, paste, editing and resize; keep autosave and online/offline messaging.
- Class Workspace: all six tabs (Jurnal Mengajar, Presensi, Nilai, Tugas, Pengumuman, Riwayat); shared visual tokens, clear status states, tablet-friendly tab navigation.
- Schedule: week selector, day cards, add/delete schedule flows and modal states.
- Student / class management: class list, student roster, import and management states.
- Shared component patterns: page shell, headers, cards, primary/secondary actions, fields, tabs, tables, badges, save state, empty/loading/error states, confirmation dialogs.
- Adaptive navigation: mobile bottom navigation; tablet layout based on effective width and usable labels; desktop side index only if compatible with existing route/role model. Preserve existing route and role behavior.

## Visual tokens (initial values; contrast must be measured)
| Token | Value | Purpose |
|---|---|---|
| workspace | #F7F5EF | warm page background |
| paper | #FFFEF9 | cards and working surfaces |
| ink | #242923 | primary text |
| ink-muted | #5D665E | secondary text |
| green | #2F6B4F | primary action and active navigation |
| green-strong | #24563F | emphasized text/action |
| highlight | #DDF2A5 | restrained highlight |
| rule | #D9DED5 | borders and notebook rules |
| danger | semantic red | destructive/error states |
| warning | semantic amber | draft/pending states |

Typography targets: page heading 28–32px; section heading 20–22px; body 15–16px; metadata preferably at least 13px. Use a 4px spacing scale, restrained radii/shadows, clear focus indicators and icons plus labels for meaningful statuses. Do not rely on color alone.

## Responsive behavior
- Mobile: bottom navigation stays clear of content; controls are comfortably tappable; no unintended body-level horizontal overflow.
- iPad/tablet portrait and landscape: balanced table density; names and grade-average column remain identifiable while horizontally scrolling; long tab/column labels must remain discoverable rather than silently clipped.
- Desktop: use available space without excessively stretching forms or line lengths.
- Verify Safari iPad, browser zoom, keyboard focus, and narrow viewport.

## Grades and attendance safeguards
- Grades: preserve current calculation semantics, draft/saved distinction, unlock/review/save flow, and validation. Do not change grade data behavior as part of styling.
- Attendance: preserve statuses, autosave queue, retry/error handling, recap/export and completed-session behavior.
- Journal: preserve save/edit/cancel/history behavior and date semantics.
- Schedule/classes: preserve CRUD/import behavior and confirmations.

## Quick Note ruled-line implementation
The textarea line-height and CSS background-size must share the same design token/value. The rule should sit near the text baseline without crossing glyphs. Test consecutive newlines, pasted multi-line text, empty lines, long text, font scaling, textarea height changes, and online/offline autosave status. Do not add a separate line DOM that changes stored note text.

## Acceptance criteria
1. Consistent palette, typography, borders, buttons, cards and focus states across Beranda, Class Workspace, Schedule and Student/Class Management.
2. No low-contrast text or important labels clipped without an alternate way to read them. Measure WCAG 2.2 AA: normal text >= 4.5:1; large text >= 3:1; relevant non-text controls/focus indicators >= 3:1.
3. Quick Note rules align with each text line after repeated Enter, paste, edit and resize; autosave and sync behavior remain intact.
4. Navigation adapts to usable width; active state, labels, keyboard and touch behavior remain clear.
5. Grade calculations, locks, drafts and save review are unchanged; attendance statuses, autosave queue and recap are unchanged.
6. Loading, empty, saved, saving, offline, disabled and error states are understandable and consistent.
7. Build and relevant lint/type checks pass. Run existing automated tests relevant to affected areas. Record actual outcomes; do not claim tests not run.
8. Preview is checked on Safari iPad portrait/landscape and mobile/desktop viewport. No unintended horizontal body overflow or bottom-navigation overlap.
9. One PR only for this redesign. Do not merge or deploy without explicit user approval.

## Required verification
- `npm run build`
- `npm run lint` (record existing unrelated failures separately)
- Relevant existing tests for grade lock, attendance completion/autosave, schedule/class management and e2e smoke where environment allows.
- Manual responsive and accessibility checks listed above.

## Out of scope
Database/schema migrations, authorization/authentication changes, business logic, new features, production data changes, deployment, merging, and any SmadaExam changes.

---

# Status implementasi (diperbarui 2026-10-13)

Bagian di bawah mencatat kondisi NYATA. Centang hanya berarti ada bukti; sisanya dinyatakan belum.

## Inventaris aktual
Rute guru: `/` (Beranda), `/attendance` (Pusat Kegiatan Kelas, 6 tab lewat `AttendanceForm`), `/schedule`, `/classes`, `/analytics`, `/account*`, `/profile`, `/ulangan`, `/wali-kelas/*`, `/admin`, `/owner`. Rute siswa `/student/*` memakai `StudentShell` sendiri dan tidak termasuk redesign ini.
Komponen bersama: `ui/Button`, `Card`, `Badge`, `Input`, `Textarea`, `Modal`, `ConfirmDeleteModal`, `InlineAlert`, `LoadingSpinner`, `Skeleton`, `OfflineBanner`, `WorkspaceGuard`, `BottomNav`.
Tab kelas: `journal/JournalTab`, `attendance/AttendanceTab`+`AttendanceGrid`, `grades/GradesTab`+`GradesTable`, `assignments/AssignmentsTab`, `announcements/AnnouncementsTab`, `timeline/TimelineTab` (Riwayat).

## Token (app/globals.css) dan aturan pakai
Variabel CSS: `--workspace --paper --ink --ink-muted --green --green-strong --green-soft --highlight --rule --control-border --notebook-line-height --notebook-pad-block`. Utilitas Tailwind: `bg-nb-paper`, `text-nb-ink`, `text-nb-ink-muted`, `bg-nb-green`, `text-nb-green-strong`, `border-nb-rule`, `border-nb-control`, dst.
- Hijau = aksi utama/aktif/fokus. Merah/amber/ungu/teal tetap untuk makna semantik (galat/draf/dst) dan selalu disertai teks/ikon.
- `--rule` hanya garis dekoratif. Garis tepi kontrol input memakai `--control-border`.
- Target sentuh minimum 44px (`min-h-11`/`w-11 h-11`) pada tab kelas dan tombol status presensi. Fokus: cincin `nb-green` 2px.
- Skala 4px mengikuti utilitas Tailwind; skala tipografi: metadata >= 12px, isi 14-16px.

Kontras terukur (WCAG 2.2, dihitung dari nilai hex):
| Pasangan | Rasio | Hasil |
|---|---|---|
| ink / paper | 14.68 | lulus |
| ink-muted / paper | 5.90 | lulus |
| putih / green | 6.29 | lulus |
| putih / green-strong | 8.47 | lulus |
| green-strong / green-soft | 7.50 | lulus |
| ink / highlight | 12.23 | lulus |
| control-border / paper (non-teks) | 3.69 | lulus |
| rule / paper (non-teks) | 1.35 | dekoratif saja, bukan batas kontrol |
| amber-800/amber-50, red-700, purple-700, teal-700 (Badge) | >= 4.5 setelah penggelapan | lulus; nilai lama amber-600 = 3.07, teal-600 = 3.59 gagal dan sudah diganti |
| gray-400 / paper | 2.51 | gagal; `text-gray-400` di area cakupan diganti `text-nb-ink-muted` |
| teks tombol nonaktif (putih / #B6C8B8) | 1.76 | dikecualikan WCAG (kontrol nonaktif), tetap ditandai `disabled` |

## Catatan Cepat (garis kertas)
Penyebab ketidaksejajaran: padding-block textarea menggeser baris teks, sedangkan ubin gradien mulai dari tepi padding. Perbaikan CSS murni: `background-origin: content-box`, `background-clip: content-box`, `line-height` dan `background-size` memakai `--notebook-line-height`, `padding-block` memakai `--notebook-pad-block`. Format teks, autosave, status sinkron, dan offline tidak disentuh.
Tes `tests/visual/quick-note-rules.mjs` (Chromium, piksel): posisi garis pertama, jarak antar garis, dan tidak ada glyph menembus garis; 5 skenario (Enter berulang, baris kosong, paste 12 baris, teks panjang, campuran) x resize x 3 lebar viewport x skala font 1/1.25/1.5 = 90 kasus, 0 gagal. Hanya Chromium; belum dicoba di Safari.

## Perilaku responsif
- < 1280px: bottom nav 4 item (`min-h-14`), konten diberi `pb-20`.
- >= 1280px (`xl`): indeks samping 224px, konten `xl:pl-56`. Rute, peran, dan item navigasi sama dengan mobile.
- Tab kelas: baris scroll horizontal (label penuh, tidak dipotong), tombol tab >= 44px.
- Matriks nilai: kolom nama sticky kiri; kolom RATA-RATA sticky kanan mulai `md` (iPad+) agar tetap terlihat saat digulir. Di mobile tidak sticky agar ruang gulir cukup.
- Presensi (md+): kolom nama sticky; kontrol status 44px dengan huruf (H/S/I/A) + `aria-pressed`, tidak hanya warna.

## Kriteria penerimaan dan status bukti
| # | Kriteria | Status |
|---|---|---|
| 1 | Palet/komponen konsisten di Beranda, Kelas, Jadwal, Siswa | Sebagian: token + sapuan warna biru lama di komponen guru; halaman di luar cakupan (akun, wali-kelas, ulangan, owner/admin) belum |
| 2 | Kontras AA | Terukur untuk token dan Badge (tabel); audit per-halaman otomatis belum |
| 3 | Garis Catatan Cepat | Lulus 90 kasus Chromium; Safari belum |
| 4 | Navigasi adaptif | Pengguna menyatakan preview Vercel terbaru cocok dan aman; review visual manual diterima. Tidak ada hasil browser automation terpisah |
| 5 | Nilai/presensi tak berubah | Diff hanya kelas CSS/atribut ARIA; e2e grade-lock 9/9, attendance-complete-confirm 9/9 |
| 6 | State loading/kosong/simpan/offline/galat | Komponen yang ada dipertahankan; belum diaudit visual per tab |
| 7 | Build/lint/tes | Lihat matriks |
| 8 | Preview visual / Safari iPad / mobile / desktop | Preview Vercel terbaru telah diperiksa dan dinyatakan cocok/aman oleh pengguna (2026-10-13). Ini bukti review manual pengguna, bukan hasil tes otomatis atau matriks terukur untuk semua viewport |
| 9 | Satu PR, tanpa merge/deploy | PR #72 |

## Matriks tes (hasil nyata)
| Tes | Hasil |
|---|---|
| `npm run build` (env Firebase emulator palsu) | lulus |
| `tsc --noEmit` | bersih |
| `eslint app src` (binari lokal) | 114 error/18 warning, identik dengan `main` (baseline, bukan regresi). `npm run lint` memakai ESLint global yang crash di lingkungan ini |
| `npm run test:e2e` (smoke) | 19/19 |
| `test:e2e:grade-lock` | 9/9 |
| `test:e2e:attendance-complete-confirm` | 9/9 (sempat gagal saat `role="tab"` ditambahkan; diganti `aria-pressed` agar selector tombol tetap valid) |
| `test:e2e:rename-class` | 14/14 |
| `test:e2e:onboarding` | 11/11 |
| `tests/visual/quick-note-rules.mjs` | 90/90 |
| `test:rules` (Firestore & Storage Rules) | GitHub Actions workflow `Test Firestore & Storage Rules` berstatus `success` pada commit `293313a8c61e2a4ed7670112966cd8261e953932` |
| e2e jadwal/impor siswa | Tidak ada skrip khusus di `package.json`; belum ada tes khusus yang dijalankan. Operasi bisnis tidak diubah oleh redesign, tetapi tes regresi khusus masih direkomendasikan sebelum cakupan fitur tersebut dikembangkan |
| Preview visual mobile/iPad/desktop, Safari iPad | Pengguna telah menyetujui preview Vercel terbaru secara visual. Tidak ada tes visual otomatis lintas-browser yang dijalankan |

## Ditunda (sengaja)
- Mode gelap: tetap `color-scheme: light` sampai dirancang dan diuji penuh.
- Sapuan warna pada halaman `/account*`, `/wali-kelas/*`, `/ulangan`, `/admin`, `/owner`, `/analytics` dan area siswa: di luar enam area wajib; risiko regresi tanpa pratinjau visual.
- `TimelineTab` (Riwayat): biru dipertahankan karena membedakan jenis item jurnal vs presensi.
- Ukuran font 8-10px yang tersisa di beberapa metadata: perlu pratinjau perangkat sebelum dinaikkan.
- Tab kelas belum memakai pola ARIA `tablist/tab`: mengubah role tombol memecah selector e2e yang ada; memakai `aria-pressed`. Migrasi menunggu pembaruan e2e.
- Verifikasi Safari iPad dan screenshot responsif: butuh perangkat/preview.
