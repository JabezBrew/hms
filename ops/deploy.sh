#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TARGET="gcp-staging"
ACTION="deploy"
MODE="auto"
DRY_RUN="false"
FORCE_SKIP_PULL=""
SKIP_HEALTHCHECK="false"
VERIFY_APPLY="false"
ASSUME_MANAGED_BACKUP="false"

GCP_PROJECT="${GCP_PROJECT:-hms-perf-lab}"
GCP_ZONE="${GCP_ZONE:-africa-south1-a}"
GCP_APP_INSTANCE="${GCP_APP_INSTANCE:-hms-gcp-app-1}"
GCP_REMOTE_ROOT="${GCP_REMOTE_ROOT:-/opt/hms}"
GCP_CLOUDSQL_INSTANCE="${GCP_CLOUDSQL_INSTANCE:-hms-staging-pg-1}"
GCP_CLOUDSQL_HOST="${GCP_CLOUDSQL_HOST:-10.216.13.2}"
GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS="${GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS:-36}"

usage() {
  cat <<'EOF'
Usage:
  ./deploy [staging]              Upload current committed checkout and deploy GCP staging.
  ./deploy --in-place             Deploy the current /opt/hms checkout on the VM.
  ./deploy verify                 Verify the live GCP staging edge.
  ./deploy verify --apply         Reconcile and verify GCP backend/firewall shape.
  ./deploy compose --in-place     Run the reusable single-VM Compose deploy.

Targets:
  staging, gcp, gcp-staging       Current GCP staging path. Default.
  compose, compose-v2, single-vm  Generic single-VM Compose path.

Options:
  --remote                        Force local archive upload to GCP staging.
  --in-place                      Deploy the current checkout in place.
  --skip-pull                     Do not pull before in-place deploy.
  --pull                          Pull before in-place deploy when this is a Git checkout.
  --skip-healthcheck              Forward to the lower-level deploy script.
  --edge-verify=auto|required|skip
                                  Override GCP edge verification after deploy.
  --assume-managed-backup         Skip live Cloud SQL backup/PITR verification after
                                  explicitly confirming managed backups.
  --apply                         With "verify", reconcile GCP backend/firewall first.
  --dry-run                       Print the selected action without running it.
  -h, --help                      Show this help.

Environment:
  GCP_PROJECT, GCP_ZONE, GCP_APP_INSTANCE, GCP_CLOUDSQL_INSTANCE,
  GCP_CLOUDSQL_HOST, GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS
EOF
}

case "${1:-}" in
  verify)
    ACTION="verify"
    shift
    ;;
  staging|gcp|gcp-staging|compose|compose-v2|single-vm)
    TARGET="$1"
    shift
    ;;
esac

while [ "$#" -gt 0 ]; do
  case "$1" in
    staging|gcp|gcp-staging|compose|compose-v2|single-vm)
      TARGET="$1"
      ;;
    verify)
      ACTION="verify"
      ;;
    --remote)
      MODE="remote"
      ;;
    --in-place)
      MODE="in-place"
      ;;
    --skip-pull)
      FORCE_SKIP_PULL="true"
      ;;
    --pull)
      FORCE_SKIP_PULL="false"
      ;;
    --skip-healthcheck)
      SKIP_HEALTHCHECK="true"
      ;;
    --edge-verify=auto|--edge-verify=required|--edge-verify=skip)
      GCP_EDGE_VERIFY="${1#*=}"
      export GCP_EDGE_VERIFY
      ;;
    --assume-managed-backup)
      ASSUME_MANAGED_BACKUP="true"
      ;;
    --apply)
      VERIFY_APPLY="true"
      ;;
    --dry-run)
      DRY_RUN="true"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown deploy option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

case "$TARGET" in
  staging|gcp|gcp-staging)
    TARGET="gcp-staging"
    ;;
  compose|compose-v2|single-vm)
    TARGET="compose-v2"
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

has_git_checkout() {
  [ -d "$ROOT_DIR/.git" ] &&
    command -v git >/dev/null 2>&1 &&
    git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

is_deploy_host_path() {
  case "$ROOT_DIR" in
    /opt/hms|/opt/hms/*)
      return 0
      ;;
  esac
  return 1
}

print_selected() {
  printf 'Target: %s\n' "$TARGET"
  printf 'Action: %s\n' "$ACTION"
  printf 'Mode: %s\n' "$MODE"
}

validate_gcp_remote_root() {
  if [ "$GCP_REMOTE_ROOT" != "/opt/hms" ]; then
    printf 'Refusing GCP deploy with GCP_REMOTE_ROOT=%s. Current staging deploy root is /opt/hms.\n' "$GCP_REMOTE_ROOT" >&2
    exit 1
  fi
}

require_deploy_host_path() {
  if is_deploy_host_path; then
    return 0
  fi

  printf './deploy --in-place is only allowed from /opt/hms on the deploy host.\n' >&2
  printf 'From this laptop, use ./deploy staging so the archive deploy and edge verification run safely.\n' >&2
  exit 1
}

verify_cloudsql_backups() {
  require_command gcloud
  require_command python3

  backup_enabled="$(
    gcloud sql instances describe "$GCP_CLOUDSQL_INSTANCE" \
      --project "$GCP_PROJECT" \
      --format='value(settings.backupConfiguration.enabled)'
  )"
  pitr_enabled="$(
    gcloud sql instances describe "$GCP_CLOUDSQL_INSTANCE" \
      --project "$GCP_PROJECT" \
      --format='value(settings.backupConfiguration.pointInTimeRecoveryEnabled)'
  )"
  deletion_protection="$(
    gcloud sql instances describe "$GCP_CLOUDSQL_INSTANCE" \
      --project "$GCP_PROJECT" \
      --format='value(settings.deletionProtectionEnabled)'
  )"
  private_ips="$(
    gcloud sql instances describe "$GCP_CLOUDSQL_INSTANCE" \
      --project "$GCP_PROJECT" \
      --format='csv[no-heading](ipAddresses.type,ipAddresses.ipAddress)' |
      awk -F, '$1 == "PRIVATE" { print $2 }'
  )"
  latest_successful_backup_end="$(
    gcloud sql backups list \
      --instance "$GCP_CLOUDSQL_INSTANCE" \
      --project "$GCP_PROJECT" \
      --filter='status=SUCCESSFUL' \
      --sort-by='~endTime' \
      --limit=1 \
      --format='value(endTime)'
  )"

  case "$backup_enabled:$pitr_enabled:$deletion_protection" in
    True:True:True|true:true:true)
      ;;
    *)
      printf 'Cloud SQL safety check failed for %s.\n' "$GCP_CLOUDSQL_INSTANCE" >&2
      printf 'backup enabled=%s, PITR=%s, deletion protection=%s\n' "$backup_enabled" "$pitr_enabled" "$deletion_protection" >&2
      exit 1
      ;;
  esac

  if ! printf '%s\n' "$private_ips" | grep -Fx "$GCP_CLOUDSQL_HOST" >/dev/null 2>&1; then
    printf 'Cloud SQL instance %s private IP does not match expected deploy DB host %s.\n' "$GCP_CLOUDSQL_INSTANCE" "$GCP_CLOUDSQL_HOST" >&2
    printf 'Observed private IPs:\n%s\n' "$private_ips" >&2
    exit 1
  fi

  if [ -z "$latest_successful_backup_end" ]; then
    printf 'Cloud SQL safety check failed for %s: no successful backup run found.\n' "$GCP_CLOUDSQL_INSTANCE" >&2
    exit 1
  fi

  python3 - "$latest_successful_backup_end" "$GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS" <<'PY'
from datetime import datetime, timezone
import sys

backup_end = sys.argv[1]
max_age_hours = float(sys.argv[2])

try:
    backup_time = datetime.fromisoformat(backup_end.replace("Z", "+00:00"))
except ValueError as exc:
    raise SystemExit(f"Could not parse Cloud SQL backup endTime {backup_end!r}: {exc}")

if backup_time.tzinfo is None:
    backup_time = backup_time.replace(tzinfo=timezone.utc)

age_seconds = (datetime.now(timezone.utc) - backup_time).total_seconds()
if age_seconds < -300:
    raise SystemExit(f"Latest Cloud SQL backup appears to be in the future: {backup_end}")

max_age_seconds = max_age_hours * 60 * 60
if age_seconds > max_age_seconds:
    age_hours = age_seconds / 3600
    raise SystemExit(
        f"Latest successful Cloud SQL backup is {age_hours:.1f}h old; "
        f"maximum allowed is {max_age_hours:.1f}h"
    )
PY

  printf 'Cloud SQL backup/PITR/deletion-protection check passed for %s (private IP %s, latest backup %s).\n' "$GCP_CLOUDSQL_INSTANCE" "$GCP_CLOUDSQL_HOST" "$latest_successful_backup_end"
  EXTERNAL_DB_BACKUP_CONFIRMED="true"
  export EXTERNAL_DB_BACKUP_CONFIRMED
}

confirm_external_database_backup() {
  if [ "$ASSUME_MANAGED_BACKUP" = "true" ]; then
    EXTERNAL_DB_BACKUP_CONFIRMED="true"
    export EXTERNAL_DB_BACKUP_CONFIRMED
    printf 'Using explicit managed-backup acknowledgement for this deploy.\n'
    return 0
  fi

  if command -v gcloud >/dev/null 2>&1; then
    verify_cloudsql_backups
    return 0
  fi

  printf 'GCP deploy needs Cloud SQL backup/PITR confirmation before migrations.\n' >&2
  printf 'Run from this laptop with ./deploy staging, install gcloud on the deploy host, or pass --assume-managed-backup after checking Cloud SQL backups/PITR.\n' >&2
  exit 1
}

run_gcp_verify() {
  set -- "$ROOT_DIR/ops/gcp-staging/verify-edge.sh"
  if [ "$VERIFY_APPLY" = "true" ]; then
    set -- "$@" --apply
  fi

  if [ "$DRY_RUN" = "true" ]; then
    printf 'Would run: %s\n' "$*"
    return 0
  fi

  "$@"
}

run_gcp_in_place() {
  if [ "$MODE" = "auto" ]; then
    MODE="in-place"
  fi

  if [ "$DRY_RUN" != "true" ]; then
    require_deploy_host_path
  fi

  if [ -z "$FORCE_SKIP_PULL" ]; then
    if has_git_checkout; then
      FORCE_SKIP_PULL="false"
    else
      FORCE_SKIP_PULL="true"
    fi
  fi

  set -- "$ROOT_DIR/ops/gcp-staging/deploy.sh"
  if [ "$FORCE_SKIP_PULL" = "true" ]; then
    set -- "$@" --skip-pull
  fi
  if [ "$SKIP_HEALTHCHECK" = "true" ]; then
    set -- "$@" --skip-healthcheck
  fi

  if [ "$DRY_RUN" = "true" ]; then
    print_selected
    printf 'Would verify Cloud SQL backups/PITR or require explicit managed-backup acknowledgement.\n'
    printf 'Would run: %s\n' "$*"
    return 0
  fi

  confirm_external_database_backup
  "$@"
}

ensure_clean_committed_checkout() {
  if ! has_git_checkout; then
    printf 'Remote staging deploy requires a local Git checkout. Use --in-place on the VM.\n' >&2
    exit 1
  fi

  status="$(git -C "$ROOT_DIR" status --porcelain)"
  if [ -n "$status" ]; then
    printf 'Refusing remote deploy from a dirty checkout. Commit or stash first.\n' >&2
    printf '%s\n' "$status" >&2
    exit 1
  fi
}

run_gcp_remote() {
  require_command git
  validate_gcp_remote_root
  if ! has_git_checkout; then
    printf 'Remote staging deploy requires a local Git checkout. Use --in-place on the VM.\n' >&2
    exit 1
  fi

  sha="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"

  if [ "$DRY_RUN" = "true" ]; then
    print_selected
    printf 'Would archive committed SHA: %s\n' "$sha"
    printf 'Would upload to: %s:%s\n' "$GCP_APP_INSTANCE" "/tmp/hms-deploy-$sha"
    printf 'Would deploy into: %s\n' "$GCP_REMOTE_ROOT"
    printf 'Would verify Cloud SQL backups/PITR before migrations.\n'
    case "${GCP_EDGE_VERIFY:-required}" in
      skip)
        printf 'Would skip final edge verification because --edge-verify=skip was set.\n'
        ;;
      *)
        printf 'Would verify edge after remote deploy.\n'
        ;;
    esac
    return 0
  fi

  require_command gcloud
  require_command gzip
  require_command mktemp
  ensure_clean_committed_checkout
  confirm_external_database_backup

  archive="$(mktemp "${TMPDIR:-/tmp}/hms-${sha}.XXXXXX.tgz")"
  remote_tmp="/tmp/hms-deploy-$sha"
  archive_name="hms-$sha.tgz"

  cleanup() {
    rm -f "$archive"
  }
  trap cleanup EXIT HUP INT TERM

  printf 'Packaging committed checkout %s...\n' "$sha"
  git -C "$ROOT_DIR" archive --format=tar HEAD | gzip >"$archive"

  printf 'Uploading deploy archive to %s...\n' "$GCP_APP_INSTANCE"
  gcloud compute ssh "$GCP_APP_INSTANCE" \
    --project "$GCP_PROJECT" \
    --zone "$GCP_ZONE" \
    --command "rm -rf '$remote_tmp' && mkdir -p '$remote_tmp'"
  gcloud compute scp "$archive" \
    "$GCP_APP_INSTANCE:$remote_tmp/$archive_name" \
    --project "$GCP_PROJECT" \
    --zone "$GCP_ZONE"
  gcloud compute scp "$ROOT_DIR/ops/gcp-staging/install-archive.sh" \
    "$GCP_APP_INSTANCE:$remote_tmp/install-archive.sh" \
    --project "$GCP_PROJECT" \
    --zone "$GCP_ZONE"

  printf 'Installing archive and running deploy on %s...\n' "$GCP_APP_INSTANCE"
  gcloud compute ssh "$GCP_APP_INSTANCE" \
    --project "$GCP_PROJECT" \
    --zone "$GCP_ZONE" \
    --command "cd '$remote_tmp' && EXTERNAL_DB_BACKUP_CONFIRMED='true' GCP_EDGE_VERIFY='skip' sh ./install-archive.sh './$archive_name' '$sha' '/opt/hms'"

  case "${GCP_EDGE_VERIFY:-required}" in
    skip)
      printf 'Skipped final edge verification because --edge-verify=skip was set.\n'
      ;;
    auto|required)
      printf 'Verifying GCP edge from this operator machine...\n'
      "$ROOT_DIR/ops/gcp-staging/verify-edge.sh"
      ;;
    *)
      printf 'Invalid GCP_EDGE_VERIFY: %s (expected auto, required, or skip)\n' "$GCP_EDGE_VERIFY" >&2
      exit 1
      ;;
  esac
}

run_compose_in_place() {
  if [ "$MODE" != "in-place" ] && [ "$MODE" != "auto" ]; then
    printf 'compose-v2 deploy is an in-place host deploy. Use ./deploy compose --in-place.\n' >&2
    exit 1
  fi

  set -- "$ROOT_DIR/ops/compose-v2/deploy.sh"
  if [ "$FORCE_SKIP_PULL" = "true" ] || { [ -z "$FORCE_SKIP_PULL" ] && ! has_git_checkout; }; then
    set -- "$@" --skip-pull
  fi
  if [ "$SKIP_HEALTHCHECK" = "true" ]; then
    set -- "$@" --skip-healthcheck
  fi

  if [ "$DRY_RUN" = "true" ]; then
    print_selected
    printf 'Would run: %s\n' "$*"
    return 0
  fi

  "$@"
}

if [ "$ACTION" = "verify" ]; then
  if [ "$TARGET" != "gcp-staging" ]; then
    printf 'Only GCP staging has a top-level verify action today.\n' >&2
    exit 2
  fi
  run_gcp_verify
  exit 0
fi

case "$TARGET" in
  gcp-staging)
    if [ "$MODE" = "auto" ]; then
      if is_deploy_host_path; then
        MODE="in-place"
      else
        MODE="remote"
      fi
    fi

    case "$MODE" in
      in-place)
        run_gcp_in_place
        ;;
      remote)
        run_gcp_remote
        ;;
      *)
        printf 'Invalid deploy mode: %s\n' "$MODE" >&2
        exit 2
        ;;
    esac
    ;;
  compose-v2)
    run_compose_in_place
    ;;
esac
