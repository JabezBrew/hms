#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/ops/hetzner-v2/.env}"
COMPOSE_FILES="${COMPOSE_FILES:-$ROOT_DIR/ops/hetzner-v2/compose.yml $ROOT_DIR/ops/gcp-staging/cloudsql.compose.override.yml}"
DATABASE_MODE="${DATABASE_MODE:-external-postgres}"

export ENV_FILE COMPOSE_FILES DATABASE_MODE

exec "$ROOT_DIR/ops/hetzner-v2/deploy.sh" "$@"
