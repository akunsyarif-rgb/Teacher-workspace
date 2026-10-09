#!/usr/bin/env bash
# Penerapan/verifikasi/rollback migrasi hardening ke database NON-PRODUKSI (atau lokal).
#
#   STAGING_DB_URL='postgresql://postgres:***@db.<ref>.supabase.co:5432/postgres' \
#     scripts/supabase/staging.sh check|apply|verify <migrated|baseline>|down
#
#   apply  [--with-baseline]  baseline hanya bila skema kosong (atau flag eksplisit), lalu migrasi berurutan, masing-masing 1 transaksi
#   verify <mode>             cek katalog (supabase/verify/post_migration.sql); exit 1 bila ada FAIL
#   down                      rollback berurutan terbalik (membuka lagi celah A–E — hanya untuk regresi)
#
# Guard: SmadaExam SELALU ditolak. Workflow produksi hanya bila PRODUCTION_APPROVED=<ref> dan BACKUP_FILE (tidak kosong) ada.
# Host selain supabase.co/localhost ditolak. URL/sandi tidak pernah dicetak.
set -euo pipefail
cd "$(dirname "$0")/../.."

SMADA_REF=abdkrhmxfpcmgzsxzfyz
WORKFLOW_REF=htutgpjcynbnyxwgorcb
MODE="${1:-}"; shift || true
URL="${STAGING_DB_URL:-}"
die() { echo "TOLAK: $*" >&2; exit 2; }

[[ -n "$MODE" ]] || die "mode kosong (check|apply|verify|down)"
[[ -n "$URL" ]] || die "STAGING_DB_URL kosong"

# Ekstrak host & user tanpa mencetak sandi.
HOSTPART="${URL#*@}"; HOSTPART="${HOSTPART%%[:/?]*}"
USERPART="${URL#*://}"; USERPART="${USERPART%%[:@]*}"
REF=""
if [[ "$HOSTPART" =~ ^db\.([a-z0-9]{20})\.supabase\.co$ ]]; then REF="${BASH_REMATCH[1]}"
elif [[ "$USERPART" =~ ^postgres\.([a-z0-9]{20})$ && "$HOSTPART" == *.pooler.supabase.com ]]; then REF="${BASH_REMATCH[1]}"
elif [[ "$HOSTPART" == "127.0.0.1" || "$HOSTPART" == "localhost" ]]; then REF="local"
else die "host bukan Supabase maupun lokal"; fi

[[ "$REF" != "$SMADA_REF" ]] || die "project SmadaExam dilarang"
if [[ "$REF" == "$WORKFLOW_REF" ]]; then
  [[ "${PRODUCTION_APPROVED:-}" == "$WORKFLOW_REF" ]] || die "Workflow produksi butuh PRODUCTION_APPROVED=$WORKFLOW_REF (persetujuan eksplisit)"
  [[ -n "${BACKUP_FILE:-}" && -s "${BACKUP_FILE}" ]] || die "Workflow produksi butuh BACKUP_FILE (dump tidak kosong)"
  [[ "$MODE" != "down" || "${PRODUCTION_ROLLBACK_APPROVED:-}" == "yes" ]] || die "rollback produksi butuh PRODUCTION_ROLLBACK_APPROVED=yes"
fi

PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)
UP=(supabase/migrations/20261009000000_rls_hardening.sql supabase/migrations/20261009000100_auth_probe.sql)
DOWN=(supabase/rollback/20261009000100_auth_probe_down.sql supabase/rollback/20261009000000_rls_hardening_down.sql)
BASE=(supabase/baseline/001_schema.sql supabase/baseline/002_functions_triggers.sql supabase/baseline/003_rls_policies_grants.sql)
has_schema() { [[ "$("${PSQL[@]}" -At -c "select to_regclass('public.workspaces') is not null")" == "t" ]]; }

case "$MODE" in
  check)
    echo "target=$REF"
    if has_schema; then echo "skema: ada (public.workspaces)"; else echo "skema: KOSONG — apply perlu --with-baseline"; fi
    "${PSQL[@]}" -At -c "select 'tabel public: ' || count(*) from information_schema.tables where table_schema='public'"
    ;;
  apply)
    if ! has_schema; then
      [[ "${1:-}" == "--with-baseline" ]] || die "skema kosong; ulangi dengan --with-baseline"
      [[ "$REF" != "$WORKFLOW_REF" ]] || die "baseline tidak diterapkan ke produksi"
      for f in "${BASE[@]}"; do echo "baseline: $f"; "${PSQL[@]}" -1 -f "$f"; done
    fi
    for f in "${UP[@]}"; do echo "migrasi: $f"; "${PSQL[@]}" -1 -f "$f"; done
    echo "selesai; jalankan: verify migrated"
    ;;
  verify)
    VMODE="${1:-}"; [[ "$VMODE" == "migrated" || "$VMODE" == "baseline" ]] || die "verify butuh migrated|baseline"
    OUT="$("${PSQL[@]}" -At -v mode="$VMODE" -f supabase/verify/post_migration.sql)"
    echo "$OUT"
    if grep -q '^FAIL|' <<<"$OUT"; then echo "HASIL: ada FAIL" >&2; exit 1; fi
    echo "HASIL: semua PASS"
    ;;
  down)
    for f in "${DOWN[@]}"; do echo "rollback: $f"; "${PSQL[@]}" -1 -f "$f"; done
    echo "selesai; jalankan: verify baseline"
    ;;
  *) die "mode tidak dikenal: $MODE" ;;
esac
