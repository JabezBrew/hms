#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
KIT_DIR="$ROOT_DIR/ops/hetzner-v2"
COMPOSE_FILE="${COMPOSE_FILE:-$KIT_DIR/compose.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-$COMPOSE_FILE}"
ENV_FILE="${ENV_FILE:-$KIT_DIR/.env}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
PUBLIC_HEALTH_TIMEOUT="${PUBLIC_HEALTH_TIMEOUT:-30}"
PUBLIC_HEALTHCHECK_MODE="${PUBLIC_HEALTHCHECK_MODE:-auto}"
DATABASE_MODE="${DATABASE_MODE:-compose-postgres}"
EXTERNAL_DB_BACKUP_CONFIRMED="${EXTERNAL_DB_BACKUP_CONFIRMED:-false}"
SKIP_PULL="${SKIP_PULL:-false}"
SKIP_BACKUP="${SKIP_BACKUP:-false}"
SKIP_HEALTHCHECK="${SKIP_HEALTHCHECK:-false}"

usage() {
  cat <<'EOF'
Usage: ops/hetzner-v2/deploy.sh [options]

Deploy the Rust HMS V2 stack from /opt/hms.

Options:
  --skip-pull          Do not run git pull --ff-only.
  --skip-backup        Skip the required production backup gate.
  --skip-healthcheck   Skip the public HTTPS edge readiness check.
  -h, --help           Show this help.

Environment overrides:
  ENV_FILE             Default: ops/hetzner-v2/.env
  COMPOSE_FILE         Legacy single Compose file. Default: ops/hetzner-v2/compose.yml
  COMPOSE_FILES        Space-separated Compose files. Default: $COMPOSE_FILE
  DATABASE_MODE        compose-postgres|external-postgres. Default: compose-postgres
  EXTERNAL_DB_BACKUP_CONFIRMED
                       Set true after confirming managed external DB backups/PITR.
  HEALTH_TIMEOUT       Default: 180 seconds
  HEALTH_INTERVAL      Default: 5 seconds
  HEALTHCHECK_URL      Default: https://$CLIENT_DOMAIN/api/v2/health/ready
  PUBLIC_HEALTH_TIMEOUT Default: 30 seconds
  PUBLIC_HEALTHCHECK_MODE auto|required|skip. Default: auto
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-pull)
      SKIP_PULL=true
      ;;
    --skip-backup)
      SKIP_BACKUP=true
      ;;
    --skip-healthcheck)
      SKIP_HEALTHCHECK=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

step() {
  printf '\n==> %s\n' "$1"
}

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

compose() {
  compose_args=""
  for compose_file in $COMPOSE_FILES; do
    compose_args="$compose_args -f $compose_file"
  done

  # shellcheck disable=SC2086
  docker compose --env-file "$ENV_FILE" $compose_args "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

require_file() {
  if [ ! -f "$1" ]; then
    printf 'Missing required file: %s\n' "$1" >&2
    exit 1
  fi
}

wait_for_service() {
  service="$1"
  timeout="$2"
  elapsed=0

  while [ "$elapsed" -le "$timeout" ]; do
    container_id="$(compose ps -q "$service" 2>/dev/null || true)"
    if [ -n "$container_id" ]; then
      status="$(
        docker inspect \
          -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "$container_id" 2>/dev/null || true
      )"
      if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
        printf '%s is %s\n' "$service" "$status"
        return 0
      fi
    fi

    sleep "$HEALTH_INTERVAL"
    elapsed=$((elapsed + HEALTH_INTERVAL))
  done

  printf '%s did not become ready within %s seconds.\n' "$service" "$timeout" >&2
  compose logs --tail=80 "$service" >&2 || true
  exit 1
}

wait_for_public_http() {
  url="$1"
  timeout="$2"
  mode="$3"
  elapsed=0
  last_status=1

  case "$mode" in
    auto|required|skip)
      ;;
    *)
      printf 'Invalid PUBLIC_HEALTHCHECK_MODE: %s (expected auto, required, or skip)\n' "$mode" >&2
      exit 1
      ;;
  esac

  if [ "$mode" = "skip" ]; then
    printf 'Skipped public edge health check because PUBLIC_HEALTHCHECK_MODE=skip.\n'
    return 0
  fi

  while [ "$elapsed" -le "$timeout" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf 'Public edge health check passed: %s\n' "$url"
      return 0
    else
      last_status="$?"
    fi

    if [ "$mode" = "auto" ] && [ "$last_status" -eq 6 ]; then
      printf 'Public edge health check skipped: hostname does not resolve yet (%s).\n' "$url" >&2
      return 0
    fi

    sleep "$HEALTH_INTERVAL"
    elapsed=$((elapsed + HEALTH_INTERVAL))
  done

  if [ "$mode" = "required" ]; then
    printf 'Public edge health check failed after %s seconds: %s\n' "$timeout" "$url" >&2
    compose ps >&2 || true
    compose logs --tail=80 caddy >&2 || true
    compose logs --tail=80 hms-api >&2 || true
    exit 1
  fi

  printf 'WARNING: public edge health check did not pass after %s seconds: %s (curl exit %s).\n' "$timeout" "$url" "$last_status" >&2
  printf 'Deployment continues because PUBLIC_HEALTHCHECK_MODE=auto. Use required for DNS/Cloudflare cutover gates.\n' >&2
}

cd "$ROOT_DIR"

require_command git
require_command docker
require_command curl
require_file "$ENV_FILE"
for compose_file in $COMPOSE_FILES; do
  require_file "$compose_file"
done

case "$DATABASE_MODE" in
  compose-postgres|external-postgres)
    ;;
  *)
    printf 'Invalid DATABASE_MODE: %s (expected compose-postgres or external-postgres)\n' "$DATABASE_MODE" >&2
    exit 1
    ;;
esac

client_slug="$(env_value CLIENT_SLUG)"
client_domain="$(env_value CLIENT_DOMAIN)"
hms_env="$(env_value HMS_ENV)"
external_database_url="${HMS_DATABASE_URL:-$(env_value HMS_DATABASE_URL)}"
client_slug="${client_slug:-hms-v2}"
hms_env="${hms_env:-production}"

if [ -z "$client_domain" ]; then
  printf 'CLIENT_DOMAIN is required in %s\n' "$ENV_FILE" >&2
  exit 1
fi

if [ "$DATABASE_MODE" = "external-postgres" ]; then
  if [ -z "$external_database_url" ]; then
    printf 'HMS_DATABASE_URL is required in the private env or shell when DATABASE_MODE=external-postgres.\n' >&2
    exit 1
  fi

  case "$external_database_url" in
    *@db:*|*@pgbouncer:*)
      printf 'DATABASE_MODE=external-postgres cannot point HMS_DATABASE_URL at Compose db or pgbouncer.\n' >&2
      exit 1
      ;;
  esac
fi

step "Deploying $client_slug ($hms_env, database: $DATABASE_MODE) from $ROOT_DIR"

if [ "$SKIP_PULL" != "true" ]; then
  step 'Pulling latest code'
  git pull --ff-only
fi

HMS_BUILD_SHA="${HMS_BUILD_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || true)}"
HMS_DEPLOYED_AT="${HMS_DEPLOYED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
export HMS_BUILD_SHA HMS_DEPLOYED_AT

step 'Validating Compose configuration'
compose config -q

step 'Ensuring infrastructure services are running'
if [ "$DATABASE_MODE" = "compose-postgres" ]; then
  compose up -d db redis pgbouncer
  wait_for_service db "$HEALTH_TIMEOUT"
  wait_for_service redis "$HEALTH_TIMEOUT"
  wait_for_service pgbouncer "$HEALTH_TIMEOUT"
else
  printf 'Using external Postgres from HMS_DATABASE_URL; local db/pgbouncer are not started.\n'
  compose up -d redis
  wait_for_service redis "$HEALTH_TIMEOUT"
fi

if [ "$hms_env" = "production" ]; then
  if [ "$DATABASE_MODE" = "external-postgres" ]; then
    if [ "$SKIP_BACKUP" = "true" ]; then
      printf 'WARNING: skipping external database backup confirmation because --skip-backup was passed.\n' >&2
    elif [ "$EXTERNAL_DB_BACKUP_CONFIRMED" = "true" ]; then
      printf 'External database backup/PITR confirmation accepted for this deploy.\n'
    else
      printf 'Refusing production deploy with DATABASE_MODE=external-postgres until EXTERNAL_DB_BACKUP_CONFIRMED=true or --skip-backup is set.\n' >&2
      printf 'Confirm managed backups/PITR for the external database before migrations.\n' >&2
      exit 1
    fi
  elif [ "$SKIP_BACKUP" = "true" ]; then
    printf 'WARNING: skipping production backup gate because --skip-backup was passed.\n' >&2
  else
    step 'Running required production backup before migrations'
    COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" "$KIT_DIR/backup-postgres.sh"
  fi
fi

step 'Building application images'
compose build hms-api hms-worker hms-migrator frontend

step 'Running database migrations and baseline provisioning'
compose run --rm hms-migrator

step 'Starting application services'
compose up -d --no-deps hms-api hms-worker frontend
wait_for_service hms-api "$HEALTH_TIMEOUT"
wait_for_service frontend "$HEALTH_TIMEOUT"

step 'Refreshing edge proxy'
compose up -d --no-deps --force-recreate caddy
wait_for_service caddy "$HEALTH_TIMEOUT"

step 'Container status'
compose ps

if [ "$SKIP_HEALTHCHECK" = "true" ]; then
  printf 'Skipped public edge health check.\n'
else
  healthcheck_url="${HEALTHCHECK_URL:-https://$client_domain/api/v2/health/ready}"
  step "Checking public edge readiness endpoint ($PUBLIC_HEALTHCHECK_MODE)"
  wait_for_public_http "$healthcheck_url" "$PUBLIC_HEALTH_TIMEOUT" "$PUBLIC_HEALTHCHECK_MODE"
fi

step 'Deployment complete'
