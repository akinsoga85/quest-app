#!/usr/bin/env bash
# Sets up, or updates, the staging Supabase project for the MVP: the same steps
# as setup-production.sh, with the staging secrets (supabase/.env.staging,
# copied from supabase/.env.staging.example). See docs/production-setup.md, Staging.
#
#   PROJECT_REF=<staging project id> DB_URL='<staging session pooler string>' scripts/setup-staging.sh
set -euo pipefail
ENV_FILE=supabase/.env.staging exec "$(dirname "$0")/setup-production.sh" "$@"
