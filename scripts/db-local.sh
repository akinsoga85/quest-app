#!/usr/bin/env bash
# A throwaway local Postgres for the migrations and RLS tests. No Docker needed.
#   up     start (creating if needed) and load shim + migrations + seed
#   apply  load shim + migrations + seed into $DATABASE_URL (used in CI)
#   reset  wipe and start again
#   down   stop
set -euo pipefail

cmd=${1:-up}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=${PGDATA_DIR:-$ROOT/.pgdata}
PORT=${PGPORT_LOCAL:-54329}
LOCAL_URL="postgres://postgres@127.0.0.1:$PORT/quest"

BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$BIN" ] || BIN=$(dirname "$(command -v pg_ctl)")
RUN=()
# Postgres refuses to run as root.
if [ "$(id -u)" = "0" ]; then RUN=(runuser -u postgres --); fi

apply() {
  local url=$1
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/auth-shim.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql "$url" -v ON_ERROR_STOP=1 -q -f "$f"
  done
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql"
}

case $cmd in
  up)
    if [ ! -d "$DATA" ]; then
      mkdir -p "$DATA"
      if [ ${#RUN[@]} -gt 0 ]; then chown postgres "$DATA"; fi
      "${RUN[@]}" "$BIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
    fi
    "${RUN[@]}" "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/server.log" -w start >/dev/null
    psql "postgres://postgres@127.0.0.1:$PORT/postgres" -q -c "drop database if exists quest" -c "create database quest"
    apply "$LOCAL_URL"
    echo "DATABASE_URL=$LOCAL_URL"
    ;;
  apply)
    apply "${DATABASE_URL:?set DATABASE_URL}"
    ;;
  reset)
    "$0" down || true
    rm -rf "$DATA"
    "$0" up
    ;;
  down)
    "${RUN[@]}" "$BIN/pg_ctl" -D "$DATA" -w stop >/dev/null || true
    ;;
  *)
    echo "usage: $0 up|apply|reset|down" >&2
    exit 1
    ;;
esac
