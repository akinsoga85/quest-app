#!/usr/bin/env bash
# Sets up, or updates, a Supabase project from this repo: production by
# default, or staging with scripts/setup-staging.sh. Safe to run again after
# new migrations or function changes. Run it on your own computer, from
# anywhere in the repo:
#
#   PROJECT_REF=abcdefghijklmnopqrst \
#   DB_URL='postgresql://postgres.abcdefghijklmnopqrst:<password>@<host>:5432/postgres' \
#   scripts/setup-production.sh
#
# PROJECT_REF:  Project Settings → General → Project ID
# DB_URL:       the Connect button → Session pooler connection string, with the
#               database password (PRODUCTION_DB_URL also works)
# ENV_FILE:     the functions' secrets; default supabase/.env.production
#
# Needs Node 22+, psql, `npx supabase@2.121.0 login` done once, and ENV_FILE
# filled in from its .example. Never loads supabase/seed.sql (test quests).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PROJECT_REF:?set PROJECT_REF (Project Settings → General → Project ID)}"
ENV_FILE=${ENV_FILE:-supabase/.env.production}
SB=(npx --yes supabase@2.121.0)

[ -f "$ENV_FILE" ] || { echo "Copy $ENV_FILE.example to $ENV_FILE and fill it in." >&2; exit 1; }
value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }

# The test safety vendors pass every photo except known test images. They're
# for staging with staff photos only, never for a project real teens use.
if [ "$(value SAFETY_VENDORS)" = "test" ] && [[ "$ENV_FILE" != *staging* ]]; then
  echo "SAFETY_VENDORS=test is for staging only. Leave it empty in $ENV_FILE until real vendors are set up." >&2
  exit 1
fi

DB_URL=${DB_URL:-${PRODUCTION_DB_URL:-}}
[ -n "$DB_URL" ] || { echo "Set DB_URL (Connect → Session pooler connection string, with the database password)." >&2; exit 1; }
command -v psql >/dev/null || { echo "psql is needed (PostgreSQL client tools; on a Mac: brew install libpq)." >&2; exit 1; }

for k in SAFETY_WEBHOOK_SECRET COACH_WEBHOOK_SECRET DROP_WEBHOOK_SECRET DELETIONS_WEBHOOK_SECRET QUESTS_WEBHOOK_SECRET; do
  [ -n "$(value "$k")" ] || { echo "$k is empty in $ENV_FILE. Make one with: openssl rand -hex 32" >&2; exit 1; }
done

echo "1/5 Linking this repo to $PROJECT_REF"
"${SB[@]}" link --project-ref "$PROJECT_REF"

echo "2/5 Applying the migrations"
"${SB[@]}" db push --db-url "$DB_URL"

echo "3/5 Building and deploying the edge functions"
npm run build:functions
for f in safety-scan coach-review quest-writer payments evening-drop account-deletions; do
  "${SB[@]}" functions deploy "$f" --no-verify-jwt --project-ref "$PROJECT_REF"
done

echo "4/5 Setting the functions' secrets"
filled=$(mktemp)
trap 'rm -f "$filled"' EXIT
grep -E '^[A-Z_]+=.+' "$ENV_FILE" > "$filled"
"${SB[@]}" secrets set --env-file "$filled" --project-ref "$PROJECT_REF"

echo "5/5 Giving the schedules and triggers their URL and secrets (Vault)"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q \
  -v functions_url="https://$PROJECT_REF.supabase.co/functions/v1" \
  -v safety_secret="$(value SAFETY_WEBHOOK_SECRET)" \
  -v coach_secret="$(value COACH_WEBHOOK_SECRET)" \
  -v drop_secret="$(value DROP_WEBHOOK_SECRET)" \
  -v deletions_secret="$(value DELETIONS_WEBHOOK_SECRET)" \
  -v quests_secret="$(value QUESTS_WEBHOOK_SECRET)" \
  -f supabase/setup/vault.sql

echo
echo "Done. The schedules are running. Next: the dashboard steps in docs/production-setup.md"
echo "(sign-in providers, redirect URLs, the first staff member)."
