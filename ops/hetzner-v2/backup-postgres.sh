#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/ops/hetzner-v2/compose.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/ops/hetzner-v2/.env}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/ops/hetzner-v2/backups}"

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

require_restic_value() {
  key="$1"
  value="$(env_value "$key")"
  if [ -z "$value" ] || [ "${value#CHANGE_ME}" != "$value" ]; then
    printf 'Production backups require %s in %s\n' "$key" "$ENV_FILE" >&2
    exit 1
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  printf 'Missing env file: %s\n' "$ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

client_slug="$(env_value CLIENT_SLUG)"
hms_env="$(env_value HMS_ENV)"
retention_days="$(env_value BACKUP_RETENTION_DAYS)"
client_slug="${client_slug:-hms-v2}"
hms_env="${hms_env:-production}"
retention_days="${retention_days:-7}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/$client_slug-$timestamp.dump"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "$target"

find "$BACKUP_DIR" -type f -name "$client_slug-*.dump" -mtime +"$retention_days" -delete

printf 'Local Postgres dump: %s\n' "$target"

if [ "$hms_env" != "production" ]; then
  printf 'Non-production mode: skipped encrypted off-server restic backup.\n'
  exit 0
fi

command -v restic >/dev/null 2>&1 || {
  printf 'Production backups require restic installed on the VPS.\n' >&2
  exit 1
}

require_restic_value RESTIC_REPOSITORY
require_restic_value RESTIC_PASSWORD
require_restic_value AWS_ACCESS_KEY_ID
require_restic_value AWS_SECRET_ACCESS_KEY

export RESTIC_REPOSITORY="$(env_value RESTIC_REPOSITORY)"
export RESTIC_PASSWORD="$(env_value RESTIC_PASSWORD)"
export AWS_ACCESS_KEY_ID="$(env_value AWS_ACCESS_KEY_ID)"
export AWS_SECRET_ACCESS_KEY="$(env_value AWS_SECRET_ACCESS_KEY)"

if ! restic snapshots >/dev/null 2>&1; then
  restic init
fi

restic backup "$target" --tag hms-v2 --tag "$client_slug" --tag postgres
restic forget --prune --keep-daily "$retention_days" --tag "$client_slug"
restic snapshots --tag "$client_slug"
