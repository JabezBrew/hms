#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/ops/hetzner-cx23-staging/compose.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/ops/hetzner-cx23-staging/.env}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/ops/hetzner-cx23-staging/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/hms-staging-$timestamp.dump"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "$target"

find "$BACKUP_DIR" -type f -name 'hms-staging-*.dump' -mtime +"$RETENTION_DAYS" -delete

printf '%s\n' "$target"

