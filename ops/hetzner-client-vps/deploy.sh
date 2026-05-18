#!/usr/bin/env sh
# Legacy Django client VPS deploy script.
# Active Rust V2 client deploys use ops/hetzner-v2/deploy.sh.
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
KIT_DIR="$ROOT_DIR/ops/hetzner-client-vps"
COMPOSE_FILE="${COMPOSE_FILE:-$KIT_DIR/compose.yml}"
ENV_FILE="${ENV_FILE:-$KIT_DIR/.env}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
SKIP_PULL="${SKIP_PULL:-false}"
SKIP_BACKUP="${SKIP_BACKUP:-false}"
SKIP_HEALTHCHECK="${SKIP_HEALTHCHECK:-false}"

usage() {
  cat <<'EOF'
Usage: ops/hetzner-client-vps/deploy.sh [options]

Deploy the current HMS client VPS from /opt/hms.

Options:
  --skip-pull          Do not run git pull --ff-only.
  --skip-backup        Skip the required production backup gate.
  --skip-healthcheck   Skip the public HTTPS readiness check.
  -h, --help           Show this help.

Environment overrides:
  ENV_FILE             Default: ops/hetzner-client-vps/.env
  COMPOSE_FILE         Default: ops/hetzner-client-vps/compose.yml
  HEALTH_TIMEOUT       Default: 180 seconds
  HEALTH_INTERVAL      Default: 5 seconds
  HEALTHCHECK_URL      Default: https://$CLIENT_DOMAIN/api/health/ready/
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

wait_for_http() {
  url="$1"
  timeout="$2"
  elapsed=0

  while [ "$elapsed" -le "$timeout" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf 'Health check passed: %s\n' "$url"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
    elapsed=$((elapsed + HEALTH_INTERVAL))
  done

  printf 'Health check failed after %s seconds: %s\n' "$timeout" "$url" >&2
  compose ps >&2 || true
  compose logs --tail=80 caddy >&2 || true
  compose logs --tail=80 api >&2 || true
  exit 1
}

cd "$ROOT_DIR"

require_command git
require_command docker
require_command curl
require_file "$ENV_FILE"
require_file "$COMPOSE_FILE"

client_slug="$(env_value CLIENT_SLUG)"
client_domain="$(env_value CLIENT_DOMAIN)"
deployment_mode="$(env_value DEPLOYMENT_MODE)"
client_slug="${client_slug:-hms}"
deployment_mode="${deployment_mode:-demo}"

if [ -z "$client_domain" ]; then
  printf 'CLIENT_DOMAIN is required in %s\n' "$ENV_FILE" >&2
  exit 1
fi

step "Deploying $client_slug ($deployment_mode) from $ROOT_DIR"

if [ "$SKIP_PULL" != "true" ]; then
  step 'Pulling latest code'
  git pull --ff-only
fi

step 'Validating Compose configuration'
compose config -q

step 'Ensuring database services are running'
compose up -d db redis pgbouncer
wait_for_service db "$HEALTH_TIMEOUT"
wait_for_service redis "$HEALTH_TIMEOUT"
wait_for_service pgbouncer "$HEALTH_TIMEOUT"

if [ "$deployment_mode" = "production" ]; then
  if [ "$SKIP_BACKUP" = "true" ]; then
    printf 'WARNING: skipping production backup gate because --skip-backup was passed.\n' >&2
  else
    step 'Running required production backup before migrations'
    COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" "$KIT_DIR/backup-postgres.sh"
  fi
fi

step 'Building application images'
compose build

step 'Running database migrations'
compose run --rm -e DB_HOST=db -e DB_PORT=5432 -e DB_CONN_MAX_AGE=0 api python /app/run_migrations.py

step 'Starting application services'
compose up -d

step 'Refreshing edge proxy'
compose up -d --no-deps --force-recreate caddy
wait_for_service caddy "$HEALTH_TIMEOUT"

wait_for_service frontend "$HEALTH_TIMEOUT"
wait_for_service api "$HEALTH_TIMEOUT"

step 'Container status'
compose ps

if [ "$SKIP_HEALTHCHECK" = "true" ]; then
  printf 'Skipped public health check.\n'
else
  healthcheck_url="${HEALTHCHECK_URL:-https://$client_domain/api/health/ready/}"
  step 'Checking public readiness endpoint'
  wait_for_http "$healthcheck_url" "$HEALTH_TIMEOUT"
fi

step 'Deployment complete'
