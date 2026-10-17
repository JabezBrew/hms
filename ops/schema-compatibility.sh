#!/usr/bin/env sh
# Sourced by deploy/installer. No credentials or database identity are emitted.
HMS_TREATMENT_SCHEMA_EPOCH=202610170023
HMS_REFERRAL_RESPONSE_SCHEMA_EPOCH=202610170024
HMS_ADMISSION_MOVE_SCHEMA_EPOCH=202610170025

hms_valid_schema_epoch() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "${#1}" -le 14 ]
}

hms_runtime_schema_epoch() {
  compatibility_file="$1/ops/compose-v2/runtime-schema-epoch"
  if [ ! -f "$compatibility_file" ]; then
    printf '0\n'
    return 0
  fi
  compatible_epoch="$(cat "$compatibility_file")" || return 1
  if ! hms_valid_schema_epoch "$compatible_epoch"; then
    printf 'Runtime schema compatibility declaration is invalid.\n' >&2
    return 1
  fi
  case "$compatible_epoch" in
    0|202610170023|202610170024|202610170025) ;;
    *) printf 'Runtime schema compatibility declaration is unknown.\n' >&2; return 1 ;;
  esac
  printf '%s\n' "$compatible_epoch"
}

hms_validate_database_epoch() {
  # A new breaking migration must extend the explicit registry and this reader.
  case "$1" in
    0|202610170023|202610170024|202610170025) return 0 ;;
    *) printf 'Database schema compatibility could not be confirmed.\n' >&2; return 1 ;;
  esac
}

hms_validate_schema_fence() {
  if [ -e "$1" ]; then
    [ -f "$1" ] || return 1
    existing_fence="$(cat "$1")" || return 1
    hms_validate_database_epoch "$existing_fence" || return 1
  fi
}

hms_candidate_breaking_epoch() {
  declared_epoch="$(hms_runtime_schema_epoch "$1")" || return 1
  if [ -f "$1/backend-rs/migrations/202610170025_admission_moves.sql" ]; then
    if [ ! -f "$1/backend-rs/migrations/202610170024_referral_response_records.sql" ] ||
       [ ! -f "$1/backend-rs/migrations/202610170023_treatment_course_windows.sql" ]; then
      printf 'Candidate release is missing its required breaking migration.\n' >&2
      return 1
    fi
    printf '%s\n' "$HMS_ADMISSION_MOVE_SCHEMA_EPOCH"
  elif [ "$declared_epoch" = "$HMS_ADMISSION_MOVE_SCHEMA_EPOCH" ]; then
    printf 'Candidate release is missing its required breaking migration.\n' >&2
    return 1
  elif [ -f "$1/backend-rs/migrations/202610170024_referral_response_records.sql" ]; then
    if [ ! -f "$1/backend-rs/migrations/202610170023_treatment_course_windows.sql" ]; then
      printf 'Candidate release is missing its required breaking migration.\n' >&2
      return 1
    fi
    printf '%s\n' "$HMS_REFERRAL_RESPONSE_SCHEMA_EPOCH"
  elif [ "$declared_epoch" = "$HMS_REFERRAL_RESPONSE_SCHEMA_EPOCH" ]; then
    printf 'Candidate release is missing its required breaking migration.\n' >&2
    return 1
  elif [ -f "$1/backend-rs/migrations/202610170023_treatment_course_windows.sql" ]; then
    printf '%s\n' "$HMS_TREATMENT_SCHEMA_EPOCH"
  else
    if [ "$declared_epoch" = "$HMS_TREATMENT_SCHEMA_EPOCH" ]; then
      printf 'Candidate release is missing its required breaking migration.\n' >&2
      return 1
    fi
    printf '0\n'
  fi
}

hms_stop_migration_oneoffs() {
  migration_project="$1"
  case "$migration_project" in
    ''|*[!a-z0-9_-]*) return 1 ;;
  esac
  migration_ids="$(docker ps -q \
    --filter "label=com.docker.compose.project=$migration_project" \
    --filter 'label=com.docker.compose.service=hms-migrator' \
    --filter 'label=com.docker.compose.oneoff=True' 2>/dev/null)" || return 1
  migration_count=0
  for migration_id in $migration_ids; do
    case "$migration_id" in *[!a-fA-F0-9]*|'') return 1 ;; esac
    case "${#migration_id}" in 12|64) ;; *) return 1 ;; esac
    migration_count=$((migration_count + 1))
    [ "$migration_count" -le 32 ] || return 1
    docker stop --time 60 "$migration_id" >/dev/null 2>&1 || return 1
  done
  remaining_migrations="$(docker ps -q \
    --filter "label=com.docker.compose.project=$migration_project" \
    --filter 'label=com.docker.compose.service=hms-migrator' \
    --filter 'label=com.docker.compose.oneoff=True' 2>/dev/null)" || return 1
  [ -z "$remaining_migrations" ]
}

hms_require_runtime_compatible() {
  runtime_epoch="$(hms_runtime_schema_epoch "$1")" || return 1
  hms_validate_database_epoch "$2" || return 1
  if [ "$runtime_epoch" -lt "$2" ]; then
    printf 'Runtime is incompatible with the committed database schema. Use a reviewed compatible release or an explicitly reviewed database restoration.\n' >&2
    return 1
  fi
}

hms_require_candidate_schema_ready() {
  hms_require_runtime_compatible "$1" "$2" || return 1
  required_epoch="$(hms_candidate_breaking_epoch "$1")" || return 1
  if [ "$2" -lt "$required_epoch" ]; then
    printf 'Database has not reached the required runtime schema; application services remain stopped.\n' >&2
    return 1
  fi
}

hms_record_schema_attempt() {
  fence_file="$1"
  attempt_epoch="$2"
  hms_valid_schema_epoch "$attempt_epoch" || return 1
  if [ -f "$fence_file" ]; then
    prior_epoch="$(cat "$fence_file")" || return 1
    hms_valid_schema_epoch "$prior_epoch" || return 1
    if [ "$prior_epoch" -gt "$attempt_epoch" ]; then
      attempt_epoch="$prior_epoch"
    fi
  fi
  hms_atomic_state_file "$fence_file" "$attempt_epoch"
}

hms_record_deploy_stage() {
  case "$2" in
    pre_quiesce|quiescing) hms_atomic_state_file "$1" "$2" ;;
    *) return 1 ;;
  esac
}

hms_atomic_state_file() {
  python3 - "$1" "$2" <<'PY'
import os
import sys
import tempfile

target, epoch = sys.argv[1:]
temporary = None
try:
    parent = os.path.dirname(os.path.abspath(target))
    descriptor, temporary = tempfile.mkstemp(prefix='.hms-schema-', dir=parent)
    with os.fdopen(descriptor, 'w') as output:
        output.write(epoch + '\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, target)
    temporary = None
    directory = os.open(parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
except OSError:
    if temporary is not None:
        try:
            os.unlink(temporary)
        except OSError:
            pass
    sys.exit('Unable to durably record schema compatibility state.')
PY
}
