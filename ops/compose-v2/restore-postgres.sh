#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/ops/compose-v2/compose.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-$COMPOSE_FILE}"
DEFAULT_ENV_FILE="$ROOT_DIR/ops/compose-v2/.env"
if [ -z "${ENV_FILE+x}" ] && [ ! -f "$DEFAULT_ENV_FILE" ] && [ -f "$ROOT_DIR/ops/hetzner-v2/.env" ]; then
  ENV_FILE="$ROOT_DIR/ops/hetzner-v2/.env"
else
  ENV_FILE="${ENV_FILE:-$DEFAULT_ENV_FILE}"
fi
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
  printf 'Missing private deployment env file.\n' >&2
  exit 1
fi

if [ ! -f "$DUMP_PATH" ]; then
  printf 'Missing PostgreSQL dump file.\n' >&2
  exit 1
fi

client_slug="$(env_value CLIENT_SLUG)"
client_slug="${client_slug:-hms-v2}"
required_confirmation="restore-$client_slug"

if [ "${RESTORE_CONFIRM:-}" != "$required_confirmation" ]; then
  printf 'Refusing destructive restore.\n' >&2
  printf 'Set RESTORE_CONFIRM=restore-<client-slug> only after verifying the dump and target client.\n' >&2
  exit 1
fi

lease_helper="$ROOT_DIR/ops/deploy-lease.py"
if ! python3 "$lease_helper" --check >/dev/null 2>&1; then
  exec python3 "$lease_helper" -- /bin/sh "$ROOT_DIR/ops/compose-v2/restore-postgres.sh" "$@"
fi

# Validate the selected deployment, receipt bytes and PostgreSQL archive before
# stopping any writers. Legacy archives require a second explicit opt-in.
python3 "$ROOT_DIR/ops/backup_retention.py" restore-check \
  --root "$ROOT_DIR" --env-file "$ENV_FILE" --dump "$DUMP_PATH"

compose() {
  compose_args=""
  for compose_file in $COMPOSE_FILES; do
    compose_args="$compose_args -f $compose_file"
  done
  # shellcheck disable=SC2086
  docker compose --env-file "$ENV_FILE" $compose_args "$@"
}

printf 'Stopping Rust HMS V2 application services for the confirmed restore...\n'
compose stop hms-api hms-worker caddy

printf 'Restoring the validated PostgreSQL archive...\n'
if ! compose exec -T db \
  sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
  < "$DUMP_PATH" >/dev/null 2>&1; then
  printf 'Database restore failed; application services remain stopped.\n' >&2
  exit 1
fi

printf 'Running migrations after restore...\n'
compose run --rm hms-migrator

printf 'Starting app services...\n'
compose up -d hms-api hms-worker frontend caddy

printf 'Restore complete. Check /api/v2/health/ready before returning the client to service.\n'
