#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
KIT_DIR="$ROOT_DIR/ops/compose-v2"
COMPOSE_FILE="${COMPOSE_FILE:-$KIT_DIR/compose.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-$COMPOSE_FILE}"
DEFAULT_ENV_FILE="$KIT_DIR/.env"
if [ -z "${ENV_FILE+x}" ] && [ ! -f "$DEFAULT_ENV_FILE" ] && [ -f "$ROOT_DIR/ops/hetzner-v2/.env" ]; then
  ENV_FILE="$ROOT_DIR/ops/hetzner-v2/.env"
else
  ENV_FILE="${ENV_FILE:-$DEFAULT_ENV_FILE}"
fi
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
PUBLIC_HEALTH_TIMEOUT="${PUBLIC_HEALTH_TIMEOUT:-30}"
PUBLIC_HEALTHCHECK_MODE="${PUBLIC_HEALTHCHECK_MODE:-auto}"
DATABASE_MODE="${DATABASE_MODE:-compose-postgres}"
EXTERNAL_DB_BACKUP_CONFIRMED="${EXTERNAL_DB_BACKUP_CONFIRMED:-false}"
EXTERNAL_DB_BACKUP_TARGET_HOST="${EXTERNAL_DB_BACKUP_TARGET_HOST:-}"
ALLOW_UNSAFE_SKIP_EXTERNAL_DB_BACKUP="${ALLOW_UNSAFE_SKIP_EXTERNAL_DB_BACKUP:-false}"
EXTERNAL_DB_STOP_LOCAL_SERVICES="${EXTERNAL_DB_STOP_LOCAL_SERVICES:-true}"
DB_CONNECTIVITY_CHECK="${DB_CONNECTIVITY_CHECK:-true}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-false}"
HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED="${HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED:-false}"
SKIP_PULL="${SKIP_PULL:-false}"
SKIP_BACKUP="${SKIP_BACKUP:-false}"
SKIP_HEALTHCHECK="${SKIP_HEALTHCHECK:-false}"
COMPOSE_CONFIG_FILE=""

usage() {
  cat <<'EOF'
Usage: ops/compose-v2/deploy.sh [options]

Deploy the Rust HMS V2 stack from /opt/hms.

Options:
  --skip-pull          Do not run git pull --ff-only.
  --skip-backup        Skip the required production backup gate.
  --skip-migrations    Skip hms-migrator. Requires
                       HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED=true and is only
                       for rollback runtime recreation after a failed
                       migration-forward deploy.
  --skip-healthcheck   Skip the public HTTPS edge readiness check.
  -h, --help           Show this help.

Environment overrides:
  ENV_FILE             Default: ops/compose-v2/.env
  COMPOSE_FILE         Legacy single Compose file. Default: ops/compose-v2/compose.yml
  COMPOSE_FILES        Space-separated Compose files. Default: $COMPOSE_FILE
  DATABASE_MODE        compose-postgres|external-postgres. Default: compose-postgres
  EXTERNAL_DB_BACKUP_CONFIRMED
                       Set true after confirming managed external DB backups/PITR.
  EXTERNAL_DB_BACKUP_TARGET_HOST
                       Required with external-postgres production backups; must match HMS_DATABASE_URL host.
  ALLOW_UNSAFE_SKIP_EXTERNAL_DB_BACKUP
                       Required true before --skip-backup can bypass external DB backup confirmation.
  EXTERNAL_DB_STOP_LOCAL_SERVICES
                       Stop stale local db/pgbouncer containers in external-postgres mode. Default: true
  DB_CONNECTIVITY_CHECK
                       Run hms-migrator check-db before migrations. Default: true
  SKIP_MIGRATIONS      Skip hms-migrator. Default: false
  HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED
                       Required true with SKIP_MIGRATIONS=true. Default: false
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
    --skip-migrations)
      SKIP_MIGRATIONS=true
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

strip_wrapping_quotes() {
  value="$1"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

database_url_host() {
  url="$1"
  without_scheme="${url#*://}"
  without_credentials="${without_scheme##*@}"
  authority="${without_credentials%%/*}"
  authority="${authority%%\?*}"
  authority="${authority%%#*}"

  case "$authority" in
    \[*\]*)
      host="${authority#\[}"
      host="${host%%]*}"
      ;;
    *:*)
      host="${authority%%:*}"
      ;;
    *)
      host="$authority"
      ;;
  esac

  printf '%s' "$host"
}

reject_external_database_host() {
  host="$1"
  source="$2"
  normalized="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"

  case "$normalized" in
    ""|db|pgbouncer|localhost|host.docker.internal|docker.for.mac.localhost|docker.for.win.localhost|0.0.0.0|127.*|::1)
      printf 'DATABASE_MODE=external-postgres cannot point %s at local/Docker database host "%s".\n' "$source" "$host" >&2
      exit 1
      ;;
  esac
}

compose() {
  compose_args=""
  for compose_file in $COMPOSE_FILES; do
    compose_args="$compose_args -f $compose_file"
  done

  # shellcheck disable=SC2086
  docker compose --env-file "$ENV_FILE" $compose_args "$@"
}

cleanup() {
  if [ -n "$COMPOSE_CONFIG_FILE" ] && [ -f "$COMPOSE_CONFIG_FILE" ]; then
    rm -f "$COMPOSE_CONFIG_FILE"
  fi
}

trap cleanup EXIT HUP INT TERM

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

validate_migration_versions() {
  migrations_dir="$ROOT_DIR/backend-rs/migrations"
  if [ ! -d "$migrations_dir" ]; then
    printf 'Missing migrations directory: %s\n' "$migrations_dir" >&2
    exit 1
  fi

  duplicates="$(
    find "$migrations_dir" -maxdepth 1 -type f -name '[0-9]*_*.sql' -exec basename {} \; |
      sed -n 's/^\([0-9][0-9]*\)_.*/\1/p' |
      sort |
      uniq -d
  )"

  if [ -z "$duplicates" ]; then
    return 0
  fi

  printf 'Duplicate SQL migration versions found in %s:\n' "$migrations_dir" >&2
  for version in $duplicates; do
    printf '  version %s\n' "$version" >&2
    find "$migrations_dir" -maxdepth 1 -type f -name "${version}_*.sql" -exec basename {} \; |
      sort |
      sed 's/^/    /' >&2
  done
  printf 'Refusing deploy before database migrations so schema history cannot be partially advanced.\n' >&2
  exit 1
}

compose_config_file() {
  COMPOSE_CONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/hms-compose-config.XXXXXX")"
  compose config >"$COMPOSE_CONFIG_FILE"
}

service_block_has() {
  service="$1"
  pattern="$2"
  awk -v service="$service" -v pattern="$pattern" '
    $0 == "  " service ":" { in_service = 1; next }
    in_service && $0 ~ /^  [A-Za-z0-9_-]+:/ { exit found ? 0 : 1 }
    in_service && index($0, pattern) > 0 { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$COMPOSE_CONFIG_FILE"
}

service_block_matches() {
  service="$1"
  pattern="$2"
  awk -v service="$service" -v pattern="$pattern" '
    $0 == "  " service ":" { in_service = 1; next }
    in_service && $0 ~ /^  [A-Za-z0-9_-]+:/ { exit found ? 0 : 1 }
    in_service && $0 ~ pattern { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$COMPOSE_CONFIG_FILE"
}

service_database_url() {
  service="$1"
  awk -v service="$service" '
    $0 == "  " service ":" { in_service = 1; next }
    in_service && $0 ~ /^  [A-Za-z0-9_-]+:/ { exit found ? 0 : 1 }
    in_service && $0 ~ /^[[:space:]]+HMS_DATABASE_URL:/ {
      sub(/^[[:space:]]+HMS_DATABASE_URL:[[:space:]]*/, "", $0)
      print
      found = 1
      exit
    }
    END { exit found ? 0 : 1 }
  ' "$COMPOSE_CONFIG_FILE"
}

compose_project_name() {
  awk '$1 == "name:" { print $2; exit }' "$COMPOSE_CONFIG_FILE"
}

validate_external_postgres_compose_contract() {
  active_services="$(compose config --services)"
  if printf '%s\n' "$active_services" | grep -Eq '^(db|pgbouncer)$'; then
    printf 'DATABASE_MODE=external-postgres must not activate Compose db or pgbouncer services.\n' >&2
    exit 1
  fi

  for service in hms-api hms-worker hms-migrator; do
    service_url="$(service_database_url "$service" || true)"
    service_url="$(strip_wrapping_quotes "$service_url")"
    if [ -z "$service_url" ]; then
      printf 'DATABASE_MODE=external-postgres requires %s to set HMS_DATABASE_URL.\n' "$service" >&2
      exit 1
    fi

    service_host="$(database_url_host "$service_url")"
    reject_external_database_host "$service_host" "$service HMS_DATABASE_URL"
    if [ -n "${external_database_host:-}" ] && [ "$service_host" != "$external_database_host" ]; then
      printf 'DATABASE_MODE=external-postgres requires %s HMS_DATABASE_URL host to match the effective external database host.\n' "$service" >&2
      exit 1
    fi
  done

  if ! service_block_has hms-migrator "      edge:"; then
    printf 'DATABASE_MODE=external-postgres requires hms-migrator on the edge network for external DB egress.\n' >&2
    exit 1
  fi
}

stop_stale_local_database_services() {
  project="$(compose_project_name)"
  if [ -z "$project" ]; then
    printf 'Could not determine Compose project name while checking stale local database containers.\n' >&2
    exit 1
  fi

  for service in db pgbouncer; do
    ids="$(
      docker ps -q \
        --filter "label=com.docker.compose.project=$project" \
        --filter "label=com.docker.compose.service=$service" \
        2>/dev/null || true
    )"
    if [ -z "$ids" ]; then
      continue
    fi

    if [ "$EXTERNAL_DB_STOP_LOCAL_SERVICES" = "true" ]; then
      printf 'Stopping stale local Compose %s container(s) for external-postgres mode.\n' "$service" >&2
      # shellcheck disable=SC2086
      docker stop $ids >/dev/null
    else
      printf 'Refusing external-postgres deploy while local Compose %s container(s) are running for project %s.\n' "$service" "$project" >&2
      printf 'Stop them or set EXTERNAL_DB_STOP_LOCAL_SERVICES=true.\n' >&2
      exit 1
    fi
  done
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

if [ "$SKIP_MIGRATIONS" = "true" ] && [ "$HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED" != "true" ]; then
  printf 'Refusing --skip-migrations without HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED=true.\n' >&2
  printf 'This option is only for rollback runtime recreation after a failed migration-forward deploy.\n' >&2
  exit 2
fi

client_slug="$(env_value CLIENT_SLUG)"
client_domain="$(env_value CLIENT_DOMAIN)"
hms_env="$(env_value HMS_ENV)"
external_database_url="${HMS_DATABASE_URL:-$(env_value HMS_DATABASE_URL)}"
external_database_host=""
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

  external_database_host="$(database_url_host "$external_database_url")"
  reject_external_database_host "$external_database_host" "HMS_DATABASE_URL"
fi

if [ "$SKIP_PULL" != "true" ]; then
  require_command git
  step "Deploying $client_slug ($hms_env, database: $DATABASE_MODE) from $ROOT_DIR"
  step 'Pulling latest code'
  git pull --ff-only
else
  step "Deploying $client_slug ($hms_env, database: $DATABASE_MODE) from $ROOT_DIR"
fi

step 'Validating SQL migration versions'
validate_migration_versions

if [ -z "${HMS_BUILD_SHA:-}" ] && command -v git >/dev/null 2>&1; then
  HMS_BUILD_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
fi
if [ -z "${HMS_BUILD_SHA:-}" ]; then
  printf 'HMS_BUILD_SHA is required when deploy source is not a Git checkout.\n' >&2
  exit 1
fi
HMS_DEPLOYED_AT="${HMS_DEPLOYED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
export HMS_BUILD_SHA HMS_DEPLOYED_AT

step 'Validating Compose configuration'
compose_config_file
if [ "$DATABASE_MODE" = "external-postgres" ]; then
  validate_external_postgres_compose_contract
fi

step 'Ensuring infrastructure services are running'
if [ "$DATABASE_MODE" = "compose-postgres" ]; then
  compose up -d db redis pgbouncer
  wait_for_service db "$HEALTH_TIMEOUT"
  wait_for_service redis "$HEALTH_TIMEOUT"
  wait_for_service pgbouncer "$HEALTH_TIMEOUT"
else
  printf 'Using external Postgres from HMS_DATABASE_URL; local db/pgbouncer are not started.\n'
  stop_stale_local_database_services
  compose up -d redis
  wait_for_service redis "$HEALTH_TIMEOUT"
fi

if [ "$hms_env" = "production" ]; then
  if [ "$DATABASE_MODE" = "external-postgres" ]; then
    if [ "$SKIP_BACKUP" = "true" ]; then
      if [ "$ALLOW_UNSAFE_SKIP_EXTERNAL_DB_BACKUP" = "true" ]; then
        printf 'WARNING: skipping external database backup confirmation because --skip-backup and ALLOW_UNSAFE_SKIP_EXTERNAL_DB_BACKUP=true were passed.\n' >&2
      else
        printf 'Refusing to skip external database backup confirmation without ALLOW_UNSAFE_SKIP_EXTERNAL_DB_BACKUP=true.\n' >&2
        exit 1
      fi
    elif [ "$EXTERNAL_DB_BACKUP_CONFIRMED" = "true" ]; then
      if [ -z "$EXTERNAL_DB_BACKUP_TARGET_HOST" ]; then
        printf 'EXTERNAL_DB_BACKUP_TARGET_HOST is required when confirming external database backups.\n' >&2
        exit 1
      fi
      if [ "$EXTERNAL_DB_BACKUP_TARGET_HOST" != "$external_database_host" ]; then
        printf 'External database backup confirmation target does not match effective HMS_DATABASE_URL host.\n' >&2
        exit 1
      fi
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

if [ "$DB_CONNECTIVITY_CHECK" = "true" ]; then
  step 'Checking database connectivity from migrator'
  compose run --rm hms-migrator hms-migrator check-db
else
  printf 'WARNING: skipped hms-migrator check-db because DB_CONNECTIVITY_CHECK=false.\n' >&2
fi

step 'Running database migrations and baseline provisioning'
if [ "$SKIP_MIGRATIONS" = "true" ]; then
  printf 'Skipped database migrations because SKIP_MIGRATIONS=true.\n'
else
  compose run --rm hms-migrator
fi

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
