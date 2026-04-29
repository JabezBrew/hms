#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/ops/hetzner-client-vps/compose.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/ops/hetzner-client-vps/.env}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/ops/hetzner-client-vps/backups}"

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

require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    printf 'Missing env file: %s\n' "$ENV_FILE" >&2
    exit 1
  fi
}

require_restic_value() {
  key="$1"
  value="$(env_value "$key")"
  if [ -z "$value" ] || [ "${value#CHANGE_ME}" != "$value" ]; then
    printf 'Production backups require %s in %s\n' "$key" "$ENV_FILE" >&2
    exit 1
  fi
}

require_env_file
mkdir -p "$BACKUP_DIR"

client_slug="$(env_value CLIENT_SLUG)"
deployment_mode="$(env_value DEPLOYMENT_MODE)"
retention_days="$(env_value BACKUP_RETENTION_DAYS)"
client_slug="${client_slug:-hms}"
deployment_mode="${deployment_mode:-demo}"
retention_days="${retention_days:-7}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/$client_slug-$timestamp.dump"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "$target"

find "$BACKUP_DIR" -type f -name "$client_slug-*.dump" -mtime +"$retention_days" -delete

printf 'Local Postgres dump: %s\n' "$target"

if [ "$deployment_mode" != "production" ]; then
  printf 'Demo mode: skipped encrypted off-server restic backup.\n'
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

restic backup "$target" --tag hms --tag "$client_slug" --tag postgres
restic forget --prune --keep-daily "$retention_days" --tag "$client_slug"
restic snapshots --tag "$client_slug"
