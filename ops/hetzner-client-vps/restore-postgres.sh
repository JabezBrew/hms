#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/ops/hetzner-client-vps/compose.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/ops/hetzner-client-vps/.env}"
DUMP_PATH="${1:-}"

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

if [ -z "$DUMP_PATH" ]; then
  printf 'Usage: RESTORE_CONFIRM=restore-<client-slug> %s <postgres.dump>\n' "$0" >&2
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  printf 'Missing env file: %s\n' "$ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$DUMP_PATH" ]; then
  printf 'Missing dump file: %s\n' "$DUMP_PATH" >&2
  exit 1
fi

client_slug="$(env_value CLIENT_SLUG)"
client_slug="${client_slug:-hms}"
required_confirmation="restore-$client_slug"

if [ "${RESTORE_CONFIRM:-}" != "$required_confirmation" ]; then
  printf 'Refusing destructive restore.\n' >&2
  printf 'Set RESTORE_CONFIRM=%s and rerun only after verifying the dump and target client.\n' "$required_confirmation" >&2
  exit 1
fi

printf 'Stopping app services for %s...\n' "$client_slug"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api worker beat

printf 'Restoring %s into the Postgres service...\n' "$DUMP_PATH"
cat "$DUMP_PATH" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl'

printf 'Starting app services...\n'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api worker beat caddy

printf 'Restore complete. Run migrations and health checks before using the client app.\n'
