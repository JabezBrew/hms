#!/usr/bin/env sh
set -eu

ARCHIVE="${1:-}"
SHA="${2:-}"
DEPLOY_ROOT="${3:-/opt/hms}"

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
      printf 'Recreating runtime from restored tree...\n' >&2
      if (
        cd "$DEPLOY_ROOT"
        HMS_BUILD_SHA="rollback-$stamp" \
          EXTERNAL_DB_BACKUP_CONFIRMED="true" \
          GCP_EDGE_VERIFY="skip" \
          ./deploy --in-place --skip-pull --skip-healthcheck --assume-managed-backup
      ); then
        printf 'Runtime restored from previous tree.\n' >&2
      else
        printf 'Runtime restore from previous tree failed; manual recovery required.\n' >&2
      fi
    elif [ -x "$DEPLOY_ROOT/ops/gcp-staging/deploy.sh" ]; then
      printf 'Recreating runtime from restored tree with legacy GCP deploy wrapper...\n' >&2
      if (
        cd "$DEPLOY_ROOT"
        HMS_BUILD_SHA="rollback-$stamp" \
          EXTERNAL_DB_BACKUP_CONFIRMED="true" \
          GCP_EDGE_VERIFY="skip" \
          ops/gcp-staging/deploy.sh --skip-pull --skip-healthcheck
      ); then
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
