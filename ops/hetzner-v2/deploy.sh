#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
KIT_DIR="$ROOT_DIR/ops/hetzner-v2"
COMPOSE_FILE="${COMPOSE_FILE:-$KIT_DIR/compose.yml}"
ENV_FILE="${ENV_FILE:-$KIT_DIR/.env}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
PUBLIC_HEALTH_TIMEOUT="${PUBLIC_HEALTH_TIMEOUT:-30}"
PUBLIC_HEALTHCHECK_MODE="${PUBLIC_HEALTHCHECK_MODE:-auto}"
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
  COMPOSE_FILE         Default: ops/hetzner-v2/compose.yml
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
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
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
require_file "$COMPOSE_FILE"

client_slug="$(env_value CLIENT_SLUG)"
client_domain="$(env_value CLIENT_DOMAIN)"
hms_env="$(env_value HMS_ENV)"
client_slug="${client_slug:-hms-v2}"
hms_env="${hms_env:-production}"

if [ -z "$client_domain" ]; then
  printf 'CLIENT_DOMAIN is required in %s\n' "$ENV_FILE" >&2
  exit 1
fi

step "Deploying $client_slug ($hms_env) from $ROOT_DIR"

if [ "$SKIP_PULL" != "true" ]; then
  step 'Pulling latest code'
  git pull --ff-only
fi

HMS_BUILD_SHA="${HMS_BUILD_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || true)}"
HMS_DEPLOYED_AT="${HMS_DEPLOYED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
export HMS_BUILD_SHA HMS_DEPLOYED_AT

step 'Validating Compose configuration'
compose config -q

step 'Ensuring database services are running'
compose up -d db redis pgbouncer
wait_for_service db "$HEALTH_TIMEOUT"
wait_for_service redis "$HEALTH_TIMEOUT"
wait_for_service pgbouncer "$HEALTH_TIMEOUT"

if [ "$hms_env" = "production" ]; then
  if [ "$SKIP_BACKUP" = "true" ]; then
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
