# supabase/

Bukan sumber kebenaran produksi. Isinya salinan/usulan untuk ditinjau dan diuji lokal:

- `baseline/`: skema + RLS project Supabase "Workflow" hasil ekspor read-only dari katalog (2026-10-09).
- `migrations/`: usulan migrasi. **Belum diterapkan** ke produksi.
- `test-support/`: stub `auth` hanya untuk uji lokal.

Uji: lihat `docs/MIGRASI-SUPABASE.md` bagian 4 (`tests/rls-parity.test.ts`).
- `rollback/`: skrip kebalikan tiap migrasi (diuji: hasilnya identik dengan baseline).

Verifikasi auth, paket staging, backup dan rollback: `docs/MIGRASI-SUPABASE.md` bagian 7–8.
