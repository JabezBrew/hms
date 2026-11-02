#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
KIT_DIR="$ROOT_DIR/ops/free-testing"
ENV_FILE="${ENV_FILE:-$KIT_DIR/.env}"
LOCAL_ONLY=false
PUBLIC=false
HMS_PREBUILT_BUNDLE="${HMS_PREBUILT_BUNDLE:-}"
PREBUILT_ARGUMENT_SEEN=false
HMS_PREBUILT_OVERRIDE=""
PREBUILT_TEMP_DIR=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --local-only) LOCAL_ONLY=true ;;
    --public) PUBLIC=true ;;
    --prebuilt-bundle)
      if [ "$#" -lt 2 ] || [ -z "$2" ] || [ "$PREBUILT_ARGUMENT_SEEN" = true ]; then
        printf 'A single nonempty prebuilt bundle directory is required.\n' >&2; exit 2
      fi
      case "$2" in -*) printf 'Prebuilt bundle directory cannot be an option.\n' >&2; exit 2 ;; esac
      PREBUILT_ARGUMENT_SEEN=true
      HMS_PREBUILT_BUNDLE="$2"; shift ;;
    -h|--help)
      printf '%s\n' 'Usage: ops/free-testing/deploy.sh [--local-only|--public] [--prebuilt-bundle DIR]' \
        'Default: Cloudflare Access protected tunnel. --public: require HMS login only.' \
        'Prebuilt mode verifies exact ARM64 images and never builds or pulls.'
      exit 0 ;;
    *) printf 'Unknown option. Use --help.\n' >&2; exit 2 ;;
  esac
  shift
done
if [ "$LOCAL_ONLY" = true ] && [ "$PUBLIC" = true ]; then
  printf 'Choose either --local-only or --public.\n' >&2; exit 2
fi

set -- python3 "$KIT_DIR/prepare-env.py" --check "$ENV_FILE"
if [ "$LOCAL_ONLY" = false ]; then set -- "$@" --require-tunnel; fi
if [ "$PUBLIC" = true ]; then set -- "$@" --public; fi
"$@"

env_value() { awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"; }
client_domain="$(env_value CLIENT_DOMAIN)"
local_port="$(env_value HMS_TEST_HTTP_PORT)"
COMPOSE_PROJECT_NAME=hms-free-test
CLIENT_DOMAIN="$client_domain"
HMS_TEST_HTTP_PORT="$local_port"
export COMPOSE_PROJECT_NAME CLIENT_DOMAIN HMS_TEST_HTTP_PORT

# The default requires Access over the entire hostname. Explicit public mode
# checks HMS authentication at the origin and edge instead.
if [ "$LOCAL_ONLY" = false ] && [ "$PUBLIC" = false ]; then
  access_host="$(env_value HMS_TEST_ACCESS_TEAM_DOMAIN)"
  for path in / /api/v2/health/ready; do
    access_response="$(curl -sS --connect-timeout 5 --max-time 10 -o /dev/null \
      -w '%{http_code} %{redirect_url}' "https://$client_domain$path")"
    case "$access_response" in
      "302 https://$access_host/"*) ;;
      *) printf 'Cloudflare Access login challenge is missing. Configure Access for the whole hostname before deploying.\n' >&2; exit 1 ;;
    esac
  done
fi

lease_helper="$ROOT_DIR/ops/deploy-lease.py"
[ -f "$lease_helper" ] || { printf 'Host deployment lease helper is missing.\n' >&2; exit 1; }
if ! python3 "$lease_helper" --check >/dev/null 2>&1; then
  set --
  if [ "$LOCAL_ONLY" = true ]; then set -- --local-only; fi
  if [ "$PUBLIC" = true ]; then set -- --public; fi
  if [ -n "$HMS_PREBUILT_BUNDLE" ]; then set -- "$@" --prebuilt-bundle "$HMS_PREBUILT_BUNDLE"; fi
  exec python3 "$lease_helper" -- /bin/sh "$KIT_DIR/deploy.sh" "$@"
fi

export ENV_FILE
COMPOSE_FILES="$ROOT_DIR/ops/compose-v2/compose.yml $KIT_DIR/compose.yml"
export COMPOSE_FILES
if [ -n "$HMS_PREBUILT_BUNDLE" ]; then
  PREBUILT_TEMP_DIR="$(mktemp -d /tmp/hms-free-prebuilt.XXXXXX)"
  HMS_PREBUILT_OVERRIDE="$PREBUILT_TEMP_DIR/compose.yml"
  HMS_PREBUILT_PROFILE=free-testing
  HMS_PREBUILT_TUNNEL=true
  if [ "$LOCAL_ONLY" = true ]; then HMS_PREBUILT_TUNNEL=false; fi
  export HMS_PREBUILT_BUNDLE HMS_PREBUILT_OVERRIDE HMS_PREBUILT_PROFILE HMS_PREBUILT_TUNNEL
  trap 'rm -f "$PREBUILT_TEMP_DIR/compose.yml" "$PREBUILT_TEMP_DIR/compose.yml.verification.json" "$PREBUILT_TEMP_DIR/compose.yml.compose.json" "$PREBUILT_TEMP_DIR/build-info.json"; rmdir "$PREBUILT_TEMP_DIR" 2>/dev/null || true' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  HMS_PREBUILT_STATE_DIR="$(python3 "$ROOT_DIR/ops/prebuilt_state.py" --root "$ROOT_DIR")"
  HMS_SCHEMA_FENCE_FILE="$HMS_PREBUILT_STATE_DIR/schema-compatibility"
  HMS_DEPLOY_ATTEMPT_FILE="$HMS_PREBUILT_STATE_DIR/deploy-attempt"
  export HMS_PREBUILT_STATE_DIR HMS_SCHEMA_FENCE_FILE HMS_DEPLOY_ATTEMPT_FILE
fi
DATABASE_MODE=compose-postgres PUBLIC_HEALTHCHECK_MODE=skip \
  "$ROOT_DIR/ops/compose-v2/deploy.sh" --skip-pull
curl -fsS --connect-timeout 5 --max-time 10 \
  "http://127.0.0.1:$local_port/api/v2/health/ready" >/dev/null

if [ -n "$HMS_PREBUILT_BUNDLE" ]; then
  COMPOSE_FILES="$COMPOSE_FILES $HMS_PREBUILT_OVERRIDE"
  curl -fsS --connect-timeout 5 --max-time 10 --max-filesize 16384 \
    "http://127.0.0.1:$local_port/build-info.json" > "$PREBUILT_TEMP_DIR/build-info.json"
  python3 - "$ROOT_DIR" "$HMS_PREBUILT_BUNDLE" "$PREBUILT_TEMP_DIR/build-info.json" <<'PYINFO'
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / 'ops'))
from prebuilt_release import manifest, strict_json, VerificationError
try:
    value = strict_json(Path(sys.argv[3]).read_bytes())
    if value.get('commit') != manifest(Path(sys.argv[2]))['revision']:
        raise ValueError()
except (VerificationError, ValueError, OSError, TypeError, AttributeError):
    raise SystemExit('Frontend build identity did not match the verified release.')
PYINFO
fi

compose_tunnel() {
  if [ -n "$HMS_PREBUILT_BUNDLE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/ops/compose-v2/compose.yml" -f "$KIT_DIR/compose.yml" -f "$HMS_PREBUILT_OVERRIDE" "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/ops/compose-v2/compose.yml" -f "$KIT_DIR/compose.yml" "$@"
  fi
}

check_public_auth() {
  base_url="$1"
  for path in /api/v2/auth/me /api/v2/patients; do
    status="$(curl -sS --connect-timeout 5 --max-time 10 -o /dev/null \
      -w '%{http_code}' "$base_url$path")"
    if [ "$status" != 401 ]; then
      printf 'Public deployment requires anonymous protected API requests to return 401.\n' >&2
      return 1
    fi
  done
}

# Verify HMS authentication before connecting a publicly reachable tunnel.
if [ "$PUBLIC" = true ]; then
  check_public_auth "http://127.0.0.1:$local_port"
fi

if [ "$LOCAL_ONLY" = false ]; then
  if [ -n "$HMS_PREBUILT_BUNDLE" ]; then
    compose_tunnel --profile tunnel up --no-build --pull never -d --no-deps cloudflared
  else
    compose_tunnel --profile tunnel up -d cloudflared
  fi
  tunnel_ready=false
  attempts=0
  while [ "$attempts" -lt 18 ]; do
    if compose_tunnel exec -T caddy \
      wget -q -T 3 -O /dev/null http://cloudflared:2000/ready; then
      tunnel_ready=true
      break
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  if [ "$tunnel_ready" != true ]; then
    printf 'Origin is ready but the tunnel has not connected. Check the tunnel dashboard; HTTPS verification remains pending.\n' >&2
    exit 1
  fi
  if [ "$PUBLIC" = true ]; then
    if ! curl -fsS --connect-timeout 5 --max-time 10 \
      "https://$client_domain/api/v2/health/ready" >/dev/null || \
      ! check_public_auth "https://$client_domain"; then
      compose_tunnel --profile tunnel stop cloudflared
      printf 'Public verification failed; tunnel stopped. Local HMS services remain running.\n' >&2
      exit 1
    fi
    printf '%s\n' 'Public HTTPS ready; protected APIs require HMS login. Verify browser login and test workflows.'
  else
    printf '%s\n' 'Origin ready; tunnel connected. Verify HTTPS login and test workflows through Cloudflare Access before calling the deployment live.'
  fi
else
  printf '%s\n' 'Synthetic origin ready on loopback. Public HTTPS and login verification remain pending.'
fi

if [ -n "$HMS_PREBUILT_BUNDLE" ]; then
  set -- verify-containers --bundle "$HMS_PREBUILT_BUNDLE" --config "$HMS_PREBUILT_OVERRIDE.compose.json" --override "$HMS_PREBUILT_OVERRIDE"
  if [ "$LOCAL_ONLY" = false ]; then set -- "$@" --tunnel; fi
  python3 "$ROOT_DIR/ops/prebuilt_release.py" "$@"
  exposure=access
  if [ "$LOCAL_ONLY" = true ]; then exposure=local-only; fi
  if [ "$PUBLIC" = true ]; then exposure=public; fi
  set -- record --root "$ROOT_DIR" --bundle "$HMS_PREBUILT_BUNDLE" --state "$HMS_PREBUILT_STATE_DIR/releases" \
    --config "$HMS_PREBUILT_OVERRIDE.compose.json" --override "$HMS_PREBUILT_OVERRIDE" \
    --build-info "$PREBUILT_TEMP_DIR/build-info.json" --exposure "$exposure"
  if [ "$LOCAL_ONLY" = false ]; then set -- "$@" --tunnel; fi
  python3 "$ROOT_DIR/ops/prebuilt_retention.py" "$@"
fi
