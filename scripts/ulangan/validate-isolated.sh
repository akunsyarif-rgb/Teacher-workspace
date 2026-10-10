#!/usr/bin/env bash
# Validasi Ulangan Harian di lingkungan TERISOLASI (gratis; Postgres lokal/CI). TIDAK menyentuh Supabase mana pun.
#   RLS_TEST_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres \
#   POSTGREST_BIN=/path/ke/postgrest \          # biner resmi PostgREST v12.2.3 (tanpa ini suite PostgREST & e2e dilewati)
#   scripts/ulangan/validate-isolated.sh [--e2e]
# Guard: URL admin harus localhost/127.0.0.1 (menolak host lain, termasuk *.supabase.co).
set -euo pipefail
cd "$(dirname "$0")/../.."
die() { echo "TOLAK: $*" >&2; exit 2; }

URL="${RLS_TEST_ADMIN_URL:-}"
[[ -n "$URL" ]] || die "RLS_TEST_ADMIN_URL kosong (Postgres lokal)"
HOSTPART="${URL#*@}"; HOSTPART="${HOSTPART%%[:/?]*}"
[[ "$HOSTPART" == "127.0.0.1" || "$HOSTPART" == "localhost" ]] || die "host '$HOSTPART' bukan lokal — validasi ini hanya untuk Postgres lokal/CI"
command -v psql >/dev/null || die "psql tidak ada"
psql "$URL" -Atc "select 1" >/dev/null || die "Postgres lokal tidak dapat dihubungi"

echo "→ Tes ulangan (DB 3 mode pemilik, migrasi/rollback, verifikasi katalog, server, klien$( [[ -n "${POSTGREST_BIN:-}" ]] && echo ', PostgREST asli'))"
npx vitest run tests/ulangan-*.test.ts

if [[ "${1:-}" == "--e2e" ]]; then
  [[ -n "${POSTGREST_BIN:-}" ]] || die "--e2e butuh POSTGREST_BIN"
  command -v java >/dev/null || die "--e2e butuh Java (Firebase Emulator)"
  echo "→ E2E browser (guru membuat/menerbitkan, siswa mengerjakan, hasil)"
  npm run test:e2e:ulangan
fi
echo "✓ Validasi terisolasi selesai (lokal; BUKAN validasi Supabase nyata)."
