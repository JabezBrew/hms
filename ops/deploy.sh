#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TARGET="gcp-staging"
ACTION="deploy"
MODE="auto"
DRY_RUN="false"
FORCE_SKIP_PULL=""
SKIP_HEALTHCHECK="false"
SKIP_MIGRATIONS="false"
IGNORE_DIRTY="false"
VERIFY_APPLY="false"
ASSUME_MANAGED_BACKUP="false"
HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED="${HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED:-false}"

GCP_PROJECT="${GCP_PROJECT:-hms-perf-lab}"
GCP_ZONE="${GCP_ZONE:-africa-south1-a}"
GCP_APP_INSTANCE="${GCP_APP_INSTANCE:-hms-gcp-app-1}"
GCP_REMOTE_ROOT="${GCP_REMOTE_ROOT:-/opt/hms}"
GCP_CLOUDSQL_INSTANCE="${GCP_CLOUDSQL_INSTANCE:-hms-staging-pg-1}"
GCP_CLOUDSQL_HOST="${GCP_CLOUDSQL_HOST:-10.216.13.2}"
GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS="${GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS:-36}"
GCP_SSH_MODE="${GCP_SSH_MODE:-iap}"
GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS="${GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS:-15}"
GCP_REMOTE_DEPLOY_TIMEOUT_SECONDS="${GCP_REMOTE_DEPLOY_TIMEOUT_SECONDS:-2400}"
GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS="${GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS:-3}"
GCP_SSH_COMMAND_TIMEOUT_SECONDS="${GCP_SSH_COMMAND_TIMEOUT_SECONDS:-900}"
GCP_SSH_CONNECT_TIMEOUT_SECONDS="${GCP_SSH_CONNECT_TIMEOUT_SECONDS:-20}"
GCP_SSH_ALIVE_INTERVAL_SECONDS="${GCP_SSH_ALIVE_INTERVAL_SECONDS:-15}"
GCP_SSH_ALIVE_COUNT_MAX="${GCP_SSH_ALIVE_COUNT_MAX:-4}"

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
  --skip-migrations               Forward rollback-only migration skip to the
                                  lower-level deploy script. Requires
                                  HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED=true.
  --ignore-dirty                  For remote staging deploys only: ignore
                                  local uncommitted changes and deploy the
                                  committed HEAD snapshot.
  --edge-verify=auto|required|skip
                                  Override GCP edge verification after deploy.
  --ssh-mode=iap|direct           Use IAP tunneling or direct SSH for GCP
                                  staging SSH. Default: iap.
  --assume-managed-backup         Skip live Cloud SQL backup/PITR verification after
                                  explicitly confirming managed backups.
  --apply                         With "verify", reconcile GCP backend/firewall first.
  --dry-run                       Print the selected action without running it.
  -h, --help                      Show this help.

Environment:
  GCP_PROJECT, GCP_ZONE, GCP_APP_INSTANCE, GCP_CLOUDSQL_INSTANCE,
  GCP_CLOUDSQL_HOST, GCP_CLOUDSQL_BACKUP_MAX_AGE_HOURS, GCP_SSH_MODE,
  GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS, GCP_REMOTE_DEPLOY_TIMEOUT_SECONDS,
  GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS, GCP_SSH_COMMAND_TIMEOUT_SECONDS,
  GCP_SSH_CONNECT_TIMEOUT_SECONDS, GCP_SSH_ALIVE_INTERVAL_SECONDS,
  GCP_SSH_ALIVE_COUNT_MAX
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
    --skip-migrations)
      SKIP_MIGRATIONS="true"
      ;;
    --ignore-dirty)
      IGNORE_DIRTY="true"
      ;;
    --edge-verify=auto|--edge-verify=required|--edge-verify=skip)
      GCP_EDGE_VERIFY="${1#*=}"
      export GCP_EDGE_VERIFY
      ;;
    --ssh-mode=iap|--ssh-mode=direct)
      GCP_SSH_MODE="${1#*=}"
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

require_positive_integer() {
  name="$1"
  value="$2"
  case "$value" in
    ''|*[!0-9]*)
      printf '%s must be a positive integer, got: %s\n' "$name" "$value" >&2
      exit 2
      ;;
  esac
  if [ "$value" -le 0 ]; then
    printf '%s must be greater than zero, got: %s\n' "$name" "$value" >&2
    exit 2
  fi
}

validate_gcp_remote_timing() {
  require_positive_integer GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS "$GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS"
  require_positive_integer GCP_REMOTE_DEPLOY_TIMEOUT_SECONDS "$GCP_REMOTE_DEPLOY_TIMEOUT_SECONDS"
  require_positive_integer GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS "$GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS"
  require_positive_integer GCP_SSH_COMMAND_TIMEOUT_SECONDS "$GCP_SSH_COMMAND_TIMEOUT_SECONDS"
  require_positive_integer GCP_SSH_CONNECT_TIMEOUT_SECONDS "$GCP_SSH_CONNECT_TIMEOUT_SECONDS"
  require_positive_integer GCP_SSH_ALIVE_INTERVAL_SECONDS "$GCP_SSH_ALIVE_INTERVAL_SECONDS"
  require_positive_integer GCP_SSH_ALIVE_COUNT_MAX "$GCP_SSH_ALIVE_COUNT_MAX"
}

has_git_checkout() {
  [ -d "$ROOT_DIR/.git" ] &&
    command -v git >/dev/null 2>&1 &&
    git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

git_dirty_status() {
  git -C "$ROOT_DIR" status --porcelain --untracked-files=normal
}

print_dirty_status_summary() {
  status="$1"
  total="$(printf '%s\n' "$status" | wc -l | tr -d '[:space:]')"
  printf 'Dirty checkout has %s changed path(s). Full path list omitted from deploy logs; run git status --short locally.\n' "$total"
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

require_rollback_skip_migrations_gate() {
  if [ "$SKIP_MIGRATIONS" = "true" ] && [ "$HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED" != "true" ]; then
    printf 'Refusing --skip-migrations without HMS_ROLLBACK_SKIP_MIGRATIONS_ALLOWED=true.\n' >&2
    printf 'This option is only for rollback runtime recreation after a failed migration-forward deploy.\n' >&2
    exit 2
  fi
}

run_command_with_timeout() {
  timeout_seconds="$1"
  shift
  python3 -c '
import subprocess
import sys

timeout_seconds = float(sys.argv[1])
command = sys.argv[2:]

try:
    completed = subprocess.run(command, stdin=sys.stdin.buffer, timeout=timeout_seconds)
except subprocess.TimeoutExpired:
    printable = " ".join(command[:4])
    if len(command) > 4:
        printable += " ..."
    print(f"Timed out after {timeout_seconds:g}s: {printable}", file=sys.stderr)
    raise SystemExit(124)

raise SystemExit(completed.returncode)
' "$timeout_seconds" "$@"
}

gcp_compute_ssh() {
  case "$GCP_SSH_MODE" in
    iap)
      run_command_with_timeout "$GCP_SSH_COMMAND_TIMEOUT_SECONDS" \
        gcloud compute ssh "$GCP_APP_INSTANCE" \
        --project "$GCP_PROJECT" \
        --zone "$GCP_ZONE" \
        --tunnel-through-iap \
        --ssh-flag="-o ConnectTimeout=$GCP_SSH_CONNECT_TIMEOUT_SECONDS" \
        --ssh-flag="-o ServerAliveInterval=$GCP_SSH_ALIVE_INTERVAL_SECONDS" \
        --ssh-flag="-o ServerAliveCountMax=$GCP_SSH_ALIVE_COUNT_MAX" \
        "$@"
      ;;
    direct)
      run_command_with_timeout "$GCP_SSH_COMMAND_TIMEOUT_SECONDS" \
        gcloud compute ssh "$GCP_APP_INSTANCE" \
        --project "$GCP_PROJECT" \
        --zone "$GCP_ZONE" \
        --ssh-flag="-o ConnectTimeout=$GCP_SSH_CONNECT_TIMEOUT_SECONDS" \
        --ssh-flag="-o ServerAliveInterval=$GCP_SSH_ALIVE_INTERVAL_SECONDS" \
        --ssh-flag="-o ServerAliveCountMax=$GCP_SSH_ALIVE_COUNT_MAX" \
        "$@"
      ;;
    *)
      printf 'Invalid GCP_SSH_MODE: %s (expected iap or direct)\n' "$GCP_SSH_MODE" >&2
      exit 2
      ;;
  esac
}

require_deploy_host_path() {
  if is_deploy_host_path; then
    return 0
  fi

  printf './deploy --in-place is only allowed from /opt/hms on the deploy host.\n' >&2
  printf 'From this laptop, use ./deploy staging so the archive deploy and edge verification run safely.\n' >&2
  exit 1
}

validate_migration_versions_in() {
  migrations_dir="$1/backend-rs/migrations"
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
  printf 'Refusing remote deploy before upload so schema history cannot be partially advanced.\n' >&2
  exit 1
}

validate_migration_versions_at_commit() {
  commit="$1"
  if ! git -C "$ROOT_DIR" cat-file -e "$commit:backend-rs/migrations" 2>/dev/null; then
    printf 'Missing committed migrations directory: backend-rs/migrations\n' >&2
    exit 1
  fi

  duplicates="$(
    git -C "$ROOT_DIR" ls-tree -r --name-only "$commit" -- backend-rs/migrations |
      sed -n 's|^backend-rs/migrations/\([0-9][0-9]*\)_.*\.sql$|\1|p' |
      sort |
      uniq -d
  )"

  if [ -z "$duplicates" ]; then
    return 0
  fi

  printf 'Duplicate committed SQL migration versions found in %s:\n' "$commit" >&2
  for version in $duplicates; do
    printf '  version %s\n' "$version" >&2
    git -C "$ROOT_DIR" ls-tree -r --name-only "$commit" -- backend-rs/migrations |
      sed -n "s|^backend-rs/migrations/\(${version}_.*\.sql\)$|    \1|p" |
      sort >&2
  done
  printf 'Refusing remote deploy before upload so schema history cannot be partially advanced.\n' >&2
  exit 1
}

ensure_git_archive_uses_committed_attributes() {
  git_dir="$(git -C "$ROOT_DIR" rev-parse --absolute-git-dir)"
  info_attributes="$git_dir/info/attributes"
  if [ -s "$info_attributes" ]; then
    printf '%s\n' 'Refusing remote deploy because local .git/info/attributes can change git archive output.' >&2
    printf 'Remove or empty %s before deploying a committed snapshot.\n' "$info_attributes" >&2
    exit 1
  fi
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
  require_rollback_skip_migrations_gate

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
  if [ "$SKIP_MIGRATIONS" = "true" ]; then
    set -- "$@" --skip-migrations
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

  status="$(git_dirty_status)"
  if [ -n "$status" ]; then
    if [ "$IGNORE_DIRTY" = "true" ]; then
      deploy_sha="$1"
      dirty_deploy_controls="$(
        printf '%s\n' "$status" |
          grep -E '^...((deploy)|(ops/deploy\.sh)|(ops/gcp-staging/(install-archive|verify-edge)\.sh))$' || true
      )"
      if [ -n "$dirty_deploy_controls" ]; then
        printf '%s\n' 'Refusing --ignore-dirty because deploy control files have uncommitted changes.' >&2
        printf '%s\n' "$dirty_deploy_controls" >&2
        printf 'Commit or stash those deploy files before deploying committed SHA %s.\n' "$deploy_sha" >&2
        exit 1
      fi
      printf 'Dirty checkout detected. Ignoring local changes and deploying committed SHA %s only.\n' "$deploy_sha" >&2
      print_dirty_status_summary "$status" >&2
      return 0
    fi
    printf 'Refusing remote deploy from a dirty checkout. Commit or stash first.\n' >&2
    print_dirty_status_summary "$status" >&2
    exit 1
  fi
}

print_ignore_dirty_dry_run_notice() {
  if [ "$IGNORE_DIRTY" != "true" ]; then
    return 0
  fi

  status="$(git_dirty_status)"
  if [ -z "$status" ]; then
    return 0
  fi

  deploy_sha="$1"
  dirty_deploy_controls="$(
    printf '%s\n' "$status" |
      grep -E '^...((deploy)|(ops/deploy\.sh)|(ops/gcp-staging/(install-archive|verify-edge)\.sh))$' || true
  )"
  if [ -n "$dirty_deploy_controls" ]; then
    printf '%s\n' 'Dirty checkout detected. A real --ignore-dirty deploy would refuse because deploy control files have uncommitted changes.' >&2
    printf '%s\n' "$dirty_deploy_controls" >&2
    exit 1
  fi

  printf 'Dirty checkout detected. Would ignore local changes and deploy committed SHA %s only.\n' "$deploy_sha" >&2
  print_dirty_status_summary "$status" >&2
}

print_remote_deploy_log_tail() {
  remote_log="$1"
  lines="${2:-120}"
  gcp_compute_ssh \
    --command "tail -n '$lines' '$remote_log' 2>/dev/null || true" || true
}

wait_for_remote_deploy() {
  remote_log="$1"
  remote_pid_file="$2"
  timeout_seconds="$3"
  interval_seconds="$4"
  max_alive_timeouts="$5"
  elapsed_seconds=0
  last_progress=""
  ssh_failures=0
  alive_timeout_count=0

  printf 'Waiting for remote deploy to finish (remote log: %s, timeout %ss)\n' "$remote_log" "$timeout_seconds"
  while :; do
    if poll_output="$(
      gcp_compute_ssh \
        --command "if [ -f '$remote_log' ]; then grep 'REMOTE_INSTALL_EXIT_STATUS=' '$remote_log' 2>/dev/null | tail -n 1 || true; grep -E '^(==>|Deployment complete|Public edge health check passed|.*Container .* Started|.* is healthy|.* Compiling hms-|.* Finished |.* Built )' '$remote_log' 2>/dev/null | tail -n 1 || true; fi; if [ -f '$remote_pid_file' ]; then pid=\$(cat '$remote_pid_file' 2>/dev/null || true); if [ -n \"\$pid\" ]; then if kill -0 \"\$pid\" 2>/dev/null; then printf 'REMOTE_INSTALL_PID_ALIVE=%s\n' \"\$pid\"; else printf 'REMOTE_INSTALL_PID_DEAD=%s\n' \"\$pid\"; fi; fi; fi" \
        2>&1
    )"; then
      ssh_failures=0
    else
      ssh_failures=$((ssh_failures + 1))
      if [ "$ssh_failures" -eq 1 ] || [ $((ssh_failures % 4)) -eq 0 ]; then
        printf '\nRemote deploy poll failed (%s consecutive); deploy may still be running. Last SSH output:\n' "$ssh_failures" >&2
        printf '%s\n' "$poll_output" | tail -n 8 >&2
      else
        printf '!'
      fi
      poll_output=""
    fi
    status_line="$(printf '%s\n' "$poll_output" | grep 'REMOTE_INSTALL_EXIT_STATUS=' | tail -n 1 || true)"
    pid_alive_line="$(printf '%s\n' "$poll_output" | grep 'REMOTE_INSTALL_PID_ALIVE=' | tail -n 1 || true)"
    pid_dead_line="$(printf '%s\n' "$poll_output" | grep 'REMOTE_INSTALL_PID_DEAD=' | tail -n 1 || true)"
    progress_line="$(printf '%s\n' "$poll_output" | grep -v '^REMOTE_INSTALL_' | tail -n 1 || true)"

    if printf '%s\n' "$status_line" | grep -Fx 'REMOTE_INSTALL_EXIT_STATUS=0' >/dev/null 2>&1; then
      printf '\nRemote deploy finished successfully.\n'
      return 0
    fi

    if [ -n "$status_line" ]; then
      printf '\nRemote deploy failed: %s\n' "$status_line" >&2
      printf 'Recent remote deploy log:\n' >&2
      print_remote_deploy_log_tail "$remote_log" 160 >&2
      return 1
    fi

    if [ -n "$pid_dead_line" ]; then
      late_status_line="$(
        gcp_compute_ssh \
          --command "grep 'REMOTE_INSTALL_EXIT_STATUS=' '$remote_log' 2>/dev/null | tail -n 1 || true" \
          2>/dev/null || true
      )"
      if printf '%s\n' "$late_status_line" | grep -Fx 'REMOTE_INSTALL_EXIT_STATUS=0' >/dev/null 2>&1; then
        printf '\nRemote deploy finished successfully.\n'
        return 0
      fi
      if [ -n "$late_status_line" ]; then
        printf '\nRemote deploy failed: %s\n' "$late_status_line" >&2
        printf 'Recent remote deploy log:\n' >&2
        print_remote_deploy_log_tail "$remote_log" 160 >&2
        return 1
      fi
      printf '\nRemote deploy process exited before writing a status marker: %s\n' "$pid_dead_line" >&2
      printf 'Recent remote deploy log:\n' >&2
      print_remote_deploy_log_tail "$remote_log" 160 >&2
      return 1
    fi

    if [ -n "$progress_line" ] && [ "$progress_line" != "$last_progress" ]; then
      printf '%s\n' "$progress_line"
      last_progress="$progress_line"
    else
      printf '.'
    fi

    sleep "$interval_seconds"
    elapsed_seconds=$((elapsed_seconds + interval_seconds))
    if [ "$elapsed_seconds" -gt "$timeout_seconds" ]; then
      if [ -n "$pid_alive_line" ]; then
        alive_timeout_count=$((alive_timeout_count + 1))
        if [ "$alive_timeout_count" -ge "$max_alive_timeouts" ]; then
          printf '\nRemote deploy is still running after %s timeout windows (%s); refusing to wait forever.\n' "$alive_timeout_count" "$pid_alive_line" >&2
          printf 'The remote lock remains in place while the installer is alive. Recent remote deploy log:\n' >&2
          print_remote_deploy_log_tail "$remote_log" 160 >&2
          return 1
        fi
        printf '\nRemote deploy is still running after %ss (%s); continuing to avoid an ambiguous deploy state.\n' "$timeout_seconds" "$pid_alive_line" >&2
        elapsed_seconds=0
      else
        break
      fi
    fi
  done

  printf '\nTimed out waiting for remote deploy after %ss.\n' "$timeout_seconds" >&2
  printf 'Recent remote deploy log:\n' >&2
  print_remote_deploy_log_tail "$remote_log" 160 >&2
  return 1
}

run_gcp_remote() {
  require_command git
  validate_gcp_remote_root
  validate_gcp_remote_timing
  if [ "$SKIP_MIGRATIONS" = "true" ]; then
    printf '%s\n' '--skip-migrations is only allowed for in-place rollback runtime recreation.' >&2
    exit 2
  fi
  if ! has_git_checkout; then
    printf 'Remote staging deploy requires a local Git checkout. Use --in-place on the VM.\n' >&2
    exit 1
  fi

  commit="$(git -C "$ROOT_DIR" rev-parse --verify 'HEAD^{commit}')"
  sha="$(git -C "$ROOT_DIR" rev-parse --short=12 "$commit")"
  remote_deploy_id="$sha-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  ensure_git_archive_uses_committed_attributes

  if [ "$DRY_RUN" = "true" ]; then
    if [ "$IGNORE_DIRTY" = "true" ]; then
      print_ignore_dirty_dry_run_notice "$sha"
    else
      ensure_clean_committed_checkout "$sha"
    fi
    print_selected
    printf 'Would archive committed SHA: %s\n' "$commit"
    printf 'Would upload committed archive installer from %s.\n' "$commit"
    printf 'Would use GCP SSH mode: %s\n' "$GCP_SSH_MODE"
    printf 'Would stream archive over SSH to: %s:%s\n' "$GCP_APP_INSTANCE" "/tmp/hms-deploy-$remote_deploy_id"
    printf 'Would verify remote archive byte count before install.\n'
    printf 'Would run detached remote installer and poll /tmp/hms-deploy-%s.log.\n' "$remote_deploy_id"
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

  ensure_clean_committed_checkout "$sha"
  require_command gcloud
  require_command gzip
  require_command mktemp
  require_command python3
  require_command wc
  require_command date
  validate_migration_versions_at_commit "$commit"
  confirm_external_database_backup

  archive="$(mktemp "${TMPDIR:-/tmp}/hms-${sha}.XXXXXX.tgz")"
  runner="$(mktemp "${TMPDIR:-/tmp}/hms-remote-runner-${sha}.XXXXXX.sh")"
  installer="$(mktemp "${TMPDIR:-/tmp}/hms-install-archive-${sha}.XXXXXX.sh")"
  remote_tmp="/tmp/hms-deploy-$remote_deploy_id"
  archive_name="hms-$sha.tgz"
  remote_log="/tmp/hms-deploy-$remote_deploy_id.log"
  remote_pid_file="$remote_tmp/install.pid"

  cleanup() {
    rm -f "$archive" "$runner" "$installer"
  }
  trap cleanup EXIT HUP INT TERM

  printf 'Packaging committed checkout %s...\n' "$sha"
  GIT_ATTR_NOSYSTEM=1 git -C "$ROOT_DIR" -c core.attributesFile=/dev/null archive --format=tar "$commit" | gzip >"$archive"
  git -C "$ROOT_DIR" show "$commit:ops/gcp-staging/install-archive.sh" >"$installer"
  archive_bytes="$(wc -c <"$archive" | tr -d '[:space:]')"

  {
    printf '#!/usr/bin/env sh\n'
    printf 'cd "%s"\n' "$remote_tmp"
    printf 'lock_dir="/tmp/hms-deploy.lock"\n'
    printf 'if ! mkdir "$lock_dir" 2>/dev/null; then\n'
    printf '  lock_pid="$(sed -n '\''s/^runner_pid=//p'\'' "$lock_dir/info" 2>/dev/null | tail -n 1 || true)"\n'
    printf '  if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then\n'
    printf '    printf "Removing stale HMS deploy lock for dead runner pid %%s\\n" "$lock_pid" >&2\n'
    printf '    stale_lock_dir="${lock_dir}.stale.$$"\n'
    printf '    mv "$lock_dir" "$stale_lock_dir" 2>/dev/null || {\n'
    printf '      printf "Another HMS deploy changed the lock during stale-lock cleanup.\\n" >&2\n'
    printf '      printf "\\nREMOTE_INSTALL_EXIT_STATUS=75\\n"\n'
    printf '      exit 75\n'
    printf '    }\n'
    printf '    mkdir "$lock_dir" 2>/dev/null || {\n'
    printf '      mv "$stale_lock_dir" "$lock_dir" 2>/dev/null || true\n'
    printf '      printf "Another HMS deploy is already running and won the lock retry.\\n" >&2\n'
    printf '      printf "\\nREMOTE_INSTALL_EXIT_STATUS=75\\n"\n'
    printf '      exit 75\n'
    printf '    }\n'
    printf '    rm -rf "$stale_lock_dir"\n'
    printf '  else\n'
    printf '  printf "Another HMS deploy is already running. Existing lock:\\n" >&2\n'
    printf '  cat "$lock_dir/info" >&2 2>/dev/null || true\n'
    printf '  printf "\\nREMOTE_INSTALL_EXIT_STATUS=75\\n"\n'
    printf '  exit 75\n'
    printf '  fi\n'
    printf 'fi\n'
    printf 'printf "runner_pid=$$\\n" >"$lock_dir/info"\n'
    printf 'trap '\''rm -rf "$lock_dir"'\'' EXIT HUP INT TERM\n'
    printf 'printf "sha=%s\\nrunner_pid=$$\\nremote_tmp=%s\\nremote_log=%s\\nstarted_at=%s\\n" >"$lock_dir/info"\n' "$sha" "$remote_tmp" "$remote_log" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'EXTERNAL_DB_BACKUP_CONFIRMED=true GCP_EDGE_VERIFY=skip sh ./install-archive.sh "./%s" "%s" "%s"\n' "$archive_name" "$sha" "$GCP_REMOTE_ROOT"
    printf 'status=$?\n'
    printf 'printf "\\nREMOTE_INSTALL_EXIT_STATUS=%%s\\n" "$status"\n'
    printf 'exit "$status"\n'
  } >"$runner"

  printf 'Streaming deploy archive to %s over SSH...\n' "$GCP_APP_INSTANCE"
  gcp_compute_ssh \
    --command "rm -rf '$remote_tmp' && mkdir -p '$remote_tmp'"
  gcp_compute_ssh \
    --command "cat > '$remote_tmp/$archive_name'" <"$archive"
  remote_archive_bytes="$(
    gcp_compute_ssh \
      --command "wc -c < '$remote_tmp/$archive_name'"
  )"
  remote_archive_bytes="$(printf '%s' "$remote_archive_bytes" | tr -d '[:space:]')"
  if [ "$remote_archive_bytes" != "$archive_bytes" ]; then
    printf 'Remote archive byte count mismatch for %s.\n' "$remote_tmp/$archive_name" >&2
    printf 'local bytes=%s remote bytes=%s\n' "$archive_bytes" "$remote_archive_bytes" >&2
    exit 1
  fi
  gcp_compute_ssh \
    --command "cat > '$remote_tmp/install-archive.sh' && chmod +x '$remote_tmp/install-archive.sh'" <"$installer"
  gcp_compute_ssh \
    --command "cat > '$remote_tmp/run-install.sh' && chmod +x '$remote_tmp/run-install.sh'" <"$runner"

  printf 'Starting detached archive install on %s...\n' "$GCP_APP_INSTANCE"
  start_status=0
  start_output="$(
    gcp_compute_ssh \
      --command "cd '$remote_tmp' && rm -f '$remote_log' '$remote_pid_file' && (nohup sh ./run-install.sh >'$remote_log' 2>&1 </dev/null & echo \$! > '$remote_pid_file') && printf 'Remote install pid: ' && cat '$remote_pid_file'" \
      2>&1
  )" || start_status="$?"
  if [ "$start_status" -ne 0 ]; then
    printf 'Remote installer start command returned %s; polling pid/log in case it launched before SSH disconnected.\n' "$start_status" >&2
    printf '%s\n' "$start_output" | tail -n 12 >&2
  else
    printf '%s\n' "$start_output"
  fi

  wait_for_remote_deploy "$remote_log" "$remote_pid_file" "$GCP_REMOTE_DEPLOY_TIMEOUT_SECONDS" "$GCP_REMOTE_DEPLOY_POLL_INTERVAL_SECONDS" "$GCP_REMOTE_DEPLOY_MAX_ALIVE_TIMEOUTS"

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
  require_rollback_skip_migrations_gate

  set -- "$ROOT_DIR/ops/compose-v2/deploy.sh"
  if [ "$FORCE_SKIP_PULL" = "true" ] || { [ -z "$FORCE_SKIP_PULL" ] && ! has_git_checkout; }; then
    set -- "$@" --skip-pull
  fi
  if [ "$SKIP_HEALTHCHECK" = "true" ]; then
    set -- "$@" --skip-healthcheck
  fi
  if [ "$SKIP_MIGRATIONS" = "true" ]; then
    set -- "$@" --skip-migrations
  fi

  if [ "$DRY_RUN" = "true" ]; then
    print_selected
    printf 'Would run: %s\n' "$*"
    return 0
  fi

  "$@"
}

if [ "$ACTION" = "verify" ]; then
  if [ "$IGNORE_DIRTY" = "true" ]; then
    printf '%s\n' '--ignore-dirty only applies to remote GCP staging deploys.' >&2
    exit 2
  fi
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
    if [ "$IGNORE_DIRTY" = "true" ] && [ "$MODE" != "remote" ]; then
      printf '%s\n' '--ignore-dirty only applies to remote GCP staging deploys.' >&2
      exit 2
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
    if [ "$IGNORE_DIRTY" = "true" ]; then
      printf '%s\n' '--ignore-dirty only applies to remote GCP staging deploys.' >&2
      exit 2
    fi
    run_compose_in_place
    ;;
esac
