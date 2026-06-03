#!/usr/bin/env sh
set -eu

ARCHIVE="${1:-}"
SHA="${2:-}"
DEPLOY_ROOT="${3:-/opt/hms}"
RESTORE_HEALTH_TIMEOUT="${RESTORE_HEALTH_TIMEOUT:-180}"
RESTORE_HEALTH_INTERVAL="${RESTORE_HEALTH_INTERVAL:-5}"

usage() {
  cat <<'EOF'
Usage: ops/gcp-staging/install-archive.sh <archive.tgz> <sha> [deploy-root]

Installs a committed HMS archive into /opt/hms on the GCP staging VM, preserves
the private env file, keeps the previous tree as a rollback anchor, and then
runs ./deploy --in-place.
EOF
}

if [ -z "$ARCHIVE" ] || [ -z "$SHA" ]; then
  usage >&2
  exit 2
fi

if [ "$DEPLOY_ROOT" != "/opt/hms" ]; then
  printf 'Refusing archive install into %s. Current GCP staging deploy root is /opt/hms.\n' "$DEPLOY_ROOT" >&2
  exit 1
fi

if [ "${EXTERNAL_DB_BACKUP_CONFIRMED:-false}" != "true" ]; then
  printf 'Archive install requires EXTERNAL_DB_BACKUP_CONFIRMED=true after Cloud SQL backups/PITR were verified.\n' >&2
  exit 1
fi

if [ ! -f "$ARCHIVE" ]; then
  printf 'Deploy archive not found: %s\n' "$ARCHIVE" >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

as_root() {
  if "$@" 2>/dev/null; then
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    printf 'Command failed and sudo is unavailable: %s\n' "$*" >&2
    exit 1
  fi
}

preserve_private_file() {
  rel="$1"
  old_file="$DEPLOY_ROOT/$rel"
  new_file="$NEXT_ROOT/$rel"

  if [ ! -f "$old_file" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$new_file")"
  cp "$old_file" "$new_file"
  chmod 600 "$new_file"
}

validate_migration_versions_in() {
  root="$1"
  migrations_dir="$root/backend-rs/migrations"
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

  printf 'Duplicate SQL migration versions found in candidate archive %s:\n' "$migrations_dir" >&2
  for version in $duplicates; do
    printf '  version %s\n' "$version" >&2
    find "$migrations_dir" -maxdepth 1 -type f -name "${version}_*.sql" -exec basename {} \; |
      sort |
      sed 's/^/    /' >&2
  done
  printf 'Refusing archive install before swapping /opt/hms so schema history cannot be partially advanced.\n' >&2
  exit 1
}

restored_tree_supports_skip_migrations() {
  entrypoint="$1"
  "$entrypoint" --help 2>/dev/null | grep -F -- '--skip-migrations' >/dev/null 2>&1
}

wait_for_restored_service() {
  service="$1"
  timeout="$2"
  elapsed=0

  while [ "$elapsed" -le "$timeout" ]; do
    # shellcheck disable=SC2086
    container_id="$(docker compose --env-file "$env_file" $compose_args ps -q "$service" 2>/dev/null || true)"
    if [ -n "$container_id" ]; then
      status="$(
        docker inspect \
          -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "$container_id" 2>/dev/null || true
      )"
      if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
        printf '%s is %s\n' "$service" "$status" >&2
        return 0
      fi
    fi

    sleep "$RESTORE_HEALTH_INTERVAL"
    elapsed=$((elapsed + RESTORE_HEALTH_INTERVAL))
  done

  printf '%s did not become ready within %s seconds during rollback runtime recreation.\n' "$service" "$timeout" >&2
  # shellcheck disable=SC2086
  docker compose --env-file "$env_file" $compose_args ps >&2 || true
  # shellcheck disable=SC2086
  docker compose --env-file "$env_file" $compose_args logs --tail=80 "$service" >&2 || true
  return 1
}

restore_runtime_without_migrations() {
  (
    cd "$DEPLOY_ROOT"
    require_command docker

    env_file="${ENV_FILE:-$DEPLOY_ROOT/ops/compose-v2/.env}"
    compose_files="${COMPOSE_FILES:-$DEPLOY_ROOT/ops/compose-v2/compose.yml $DEPLOY_ROOT/ops/gcp-staging/compose.cloudsql.yml}"
    compose_args=""
    for compose_file in $compose_files; do
      if [ ! -f "$compose_file" ]; then
        printf 'Restored runtime recovery missing Compose file: %s\n' "$compose_file" >&2
        return 1
      fi
      compose_args="$compose_args -f $compose_file"
    done

    if [ ! -f "$env_file" ]; then
      printf 'Restored runtime recovery missing env file: %s\n' "$env_file" >&2
      return 1
    fi

    HMS_BUILD_SHA="${HMS_BUILD_SHA:-rollback-$stamp}"
    HMS_DEPLOYED_AT="${HMS_DEPLOYED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
    export HMS_BUILD_SHA HMS_DEPLOYED_AT

    printf 'Ensuring restored Redis is running...\n' >&2
    # shellcheck disable=SC2086
    docker compose --env-file "$env_file" $compose_args up -d redis
    wait_for_restored_service redis "$RESTORE_HEALTH_TIMEOUT"

    printf 'Rebuilding restored runtime images without running hms-migrator...\n' >&2
    # shellcheck disable=SC2086
    docker compose --env-file "$env_file" $compose_args build hms-api hms-worker frontend
    printf 'Starting restored runtime services without running hms-migrator...\n' >&2
    # shellcheck disable=SC2086
    docker compose --env-file "$env_file" $compose_args up -d --no-deps hms-api hms-worker frontend
    wait_for_restored_service hms-api "$RESTORE_HEALTH_TIMEOUT"
    wait_for_restored_service hms-worker "$RESTORE_HEALTH_TIMEOUT"
    wait_for_restored_service frontend "$RESTORE_HEALTH_TIMEOUT"
    printf 'Refreshing restored edge proxy...\n' >&2
    # shellcheck disable=SC2086
    docker compose --env-file "$env_file" $compose_args up -d --no-deps --force-recreate caddy
    wait_for_restored_service caddy "$RESTORE_HEALTH_TIMEOUT"
  )
}

require_command tar
require_command date

parent_dir="$(dirname "$DEPLOY_ROOT")"
stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
NEXT_ROOT="$parent_dir/hms-next"
ROLLBACK_ROOT="$parent_dir/hms.pre-deploy-$stamp-$$"
owner="$(id -un)"
group="$(id -gn)"
DEPLOY_SWAPPED="false"

restore_previous_tree() {
  status="$?"
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  if [ "$DEPLOY_SWAPPED" != "true" ]; then
    return "$status"
  fi

  FAILED_ROOT="$parent_dir/hms.failed-deploy-$stamp-$$"
  printf 'Deploy failed; restoring previous tree from %s.\n' "$ROLLBACK_ROOT" >&2
  if [ -e "$DEPLOY_ROOT" ]; then
    as_root mv "$DEPLOY_ROOT" "$FAILED_ROOT" || true
  fi
  if [ -e "$ROLLBACK_ROOT" ]; then
    as_root mv "$ROLLBACK_ROOT" "$DEPLOY_ROOT" || true
    as_root chown -R "$owner:$group" "$DEPLOY_ROOT" || true
    printf 'Previous tree restored to %s. Failed release retained at %s.\n' "$DEPLOY_ROOT" "$FAILED_ROOT" >&2
    if [ -x "$DEPLOY_ROOT/deploy" ]; then
      printf 'Recreating runtime from restored tree without rerunning migrations...\n' >&2
      if restored_tree_supports_skip_migrations "$DEPLOY_ROOT/deploy"; then
        restore_status=0
        (
          cd "$DEPLOY_ROOT"
          HMS_BUILD_SHA="rollback-$stamp" \
            EXTERNAL_DB_BACKUP_CONFIRMED="true" \
            GCP_EDGE_VERIFY="skip" \
            HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED="true" \
            ./deploy --in-place --skip-pull --skip-healthcheck --assume-managed-backup --skip-migrations
        ) || restore_status="$?"
      else
        printf 'Restored deploy wrapper has no --skip-migrations support; using direct runtime recreation.\n' >&2
        restore_status=0
        restore_runtime_without_migrations || restore_status="$?"
      fi
      if [ "$restore_status" -eq 0 ]; then
        printf 'Runtime restored from previous tree.\n' >&2
      else
        printf 'Runtime restore from previous tree failed; manual recovery required.\n' >&2
      fi
    elif [ -x "$DEPLOY_ROOT/ops/gcp-staging/deploy.sh" ]; then
      printf 'Recreating runtime from restored tree with legacy GCP deploy wrapper without rerunning migrations...\n' >&2
      if restored_tree_supports_skip_migrations "$DEPLOY_ROOT/ops/gcp-staging/deploy.sh"; then
        restore_status=0
        (
          cd "$DEPLOY_ROOT"
          HMS_BUILD_SHA="rollback-$stamp" \
            EXTERNAL_DB_BACKUP_CONFIRMED="true" \
            GCP_EDGE_VERIFY="skip" \
            HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED="true" \
            SKIP_MIGRATIONS="true" \
            ops/gcp-staging/deploy.sh --skip-pull --skip-healthcheck
        ) || restore_status="$?"
      else
        printf 'Restored legacy deploy wrapper has no --skip-migrations support; using direct runtime recreation.\n' >&2
        restore_status=0
        restore_runtime_without_migrations || restore_status="$?"
      fi
      if [ "$restore_status" -eq 0 ]; then
        printf 'Runtime restored from previous tree with legacy GCP deploy wrapper.\n' >&2
      else
        printf 'Legacy runtime restore from previous tree failed; manual recovery required.\n' >&2
      fi
    else
      printf 'Restored tree has no executable deploy entry point; manual runtime recovery required.\n' >&2
    fi
  else
    printf 'Rollback tree missing; manual recovery required for %s.\n' "$DEPLOY_ROOT" >&2
  fi
  return "$status"
}

trap restore_previous_tree EXIT HUP INT TERM

printf 'Preparing %s for deploy %s...\n' "$NEXT_ROOT" "$SHA"
as_root rm -rf "$NEXT_ROOT"
as_root mkdir -p "$NEXT_ROOT"
as_root chown "$owner:$group" "$NEXT_ROOT"

tar -xzf "$ARCHIVE" -C "$NEXT_ROOT"
validate_migration_versions_in "$NEXT_ROOT"

preserve_private_file ops/compose-v2/.env
preserve_private_file ops/hetzner-v2/.env

if [ ! -x "$NEXT_ROOT/deploy" ]; then
  chmod +x "$NEXT_ROOT/deploy"
fi
chmod +x "$NEXT_ROOT/ops/deploy.sh" \
  "$NEXT_ROOT/ops/gcp-staging/deploy.sh" \
  "$NEXT_ROOT/ops/gcp-staging/verify-edge.sh"

printf 'Swapping %s into place; previous tree becomes %s...\n' "$DEPLOY_ROOT" "$ROLLBACK_ROOT"
if [ -e "$DEPLOY_ROOT" ]; then
  as_root mv "$DEPLOY_ROOT" "$ROLLBACK_ROOT"
fi
as_root mv "$NEXT_ROOT" "$DEPLOY_ROOT"
as_root chown -R "$owner:$group" "$DEPLOY_ROOT"
DEPLOY_SWAPPED="true"

cd "$DEPLOY_ROOT"
HMS_BUILD_SHA="$SHA" \
  EXTERNAL_DB_BACKUP_CONFIRMED="true" \
  GCP_EDGE_VERIFY="${GCP_EDGE_VERIFY:-skip}" \
  ./deploy --in-place --assume-managed-backup

DEPLOY_SWAPPED="false"
printf 'Deploy %s installed successfully. Previous tree remains at %s for rollback.\n' "$SHA" "$ROLLBACK_ROOT"
