#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/ops/compose-v2/compose.yml}"
DEFAULT_ENV_FILE="$ROOT_DIR/ops/compose-v2/.env"
if [ -z "${ENV_FILE+x}" ] && [ ! -f "$DEFAULT_ENV_FILE" ] && [ -f "$ROOT_DIR/ops/hetzner-v2/.env" ]; then
  ENV_FILE="$ROOT_DIR/ops/hetzner-v2/.env"
else
  ENV_FILE="${ENV_FILE:-$DEFAULT_ENV_FILE}"
fi
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/ops/compose-v2/backups}"

# Nested invocations retain the same kernel lease as deploy and restore.
exec python3 "$ROOT_DIR/ops/deploy-lease.py" -- \
  python3 "$ROOT_DIR/ops/backup_retention.py" backup \
  --root "$ROOT_DIR" --env-file "$ENV_FILE" --backup-dir "$BACKUP_DIR"
