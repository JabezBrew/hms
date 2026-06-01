#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

DEFAULT_ENV_FILE="$ROOT_DIR/ops/compose-v2/.env"
if [ -z "${ENV_FILE+x}" ] && [ ! -f "$DEFAULT_ENV_FILE" ] && [ -f "$ROOT_DIR/ops/hetzner-v2/.env" ]; then
  ENV_FILE="$ROOT_DIR/ops/hetzner-v2/.env"
else
  ENV_FILE="${ENV_FILE:-$DEFAULT_ENV_FILE}"
fi
COMPOSE_FILES="${COMPOSE_FILES:-$ROOT_DIR/ops/compose-v2/compose.yml $ROOT_DIR/ops/gcp-staging/compose.cloudsql.yml}"

if [ "${DATABASE_MODE:-external-postgres}" != "external-postgres" ]; then
  printf 'GCP staging deploy requires DATABASE_MODE=external-postgres.\n' >&2
  exit 1
fi
DATABASE_MODE="external-postgres"

env_value() {
  key="$1"
  value="$(
    awk -F= -v key="$key" '
      $0 !~ /^[[:space:]]*#/ && $1 == key {
        sub(/^[^=]*=/, "")
        print
        exit
      }
    ' "$ENV_FILE"
  )"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

database_url_host() {
  url="$1"
  without_scheme="${url#*://}"
  without_credentials="${without_scheme##*@}"
  authority="${without_credentials%%/*}"
  authority="${authority%%\?*}"
  authority="${authority%%#*}"

  case "$authority" in
    \[*\]*)
      host="${authority#\[}"
      host="${host%%]*}"
      ;;
    *:*)
      host="${authority%%:*}"
      ;;
    *)
      host="$authority"
      ;;
  esac

  printf '%s' "$host"
}

env_database_url=""
if [ -f "$ENV_FILE" ]; then
  env_database_url="$(env_value HMS_DATABASE_URL)"
  if [ -z "$env_database_url" ]; then
    env_database_url="$(env_value HMS_CLOUDSQL_DATABASE_URL)"
  fi
fi

if [ -z "$env_database_url" ]; then
  printf 'GCP staging deploy requires HMS_DATABASE_URL in %s.\n' "$ENV_FILE" >&2
  exit 1
fi

if [ -n "${HMS_DATABASE_URL:-}" ] && [ "$HMS_DATABASE_URL" != "$env_database_url" ]; then
  printf 'Refusing GCP deploy because shell HMS_DATABASE_URL differs from %s.\n' "$ENV_FILE" >&2
  printf 'Unset HMS_DATABASE_URL or update the private env file before deploying.\n' >&2
  exit 1
fi

HMS_DATABASE_URL="$env_database_url"
effective_host="$(database_url_host "$HMS_DATABASE_URL")"
expected_host="${GCP_CLOUDSQL_HOST:-10.216.13.2}"
if [ "$effective_host" != "$expected_host" ]; then
  printf 'GCP staging HMS_DATABASE_URL host must be %s, got %s.\n' "$expected_host" "$effective_host" >&2
  exit 1
fi

EXTERNAL_DB_BACKUP_TARGET_HOST="${EXTERNAL_DB_BACKUP_TARGET_HOST:-$expected_host}"

export ENV_FILE COMPOSE_FILES DATABASE_MODE HMS_DATABASE_URL EXTERNAL_DB_BACKUP_TARGET_HOST

exec "$ROOT_DIR/ops/compose-v2/deploy.sh" "$@"
