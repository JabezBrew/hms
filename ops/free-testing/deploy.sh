#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
KIT_DIR="$ROOT_DIR/ops/free-testing"
ENV_FILE="${ENV_FILE:-$KIT_DIR/.env}"
LOCAL_ONLY=false
case "${1:-}" in
  --local-only) LOCAL_ONLY=true ;;
  -h|--help)
    printf '%s\n' 'Usage: ops/free-testing/deploy.sh [--local-only]' \
      'Deploy the synthetic stack on this Docker host; the default also starts the private Cloudflare tunnel.'
    exit 0 ;;
  '') ;;
  *) printf 'Unknown option. Use --help.\n' >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then printf 'Use --help for supported arguments.\n' >&2; exit 2; fi

set -- python3 "$KIT_DIR/prepare-env.py" --check "$ENV_FILE"
if [ "$LOCAL_ONLY" = false ]; then set -- "$@" --require-tunnel; fi
"$@"

env_value() { awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"; }
client_domain="$(env_value CLIENT_DOMAIN)"
local_port="$(env_value HMS_TEST_HTTP_PORT)"
COMPOSE_PROJECT_NAME=hms-free-test
CLIENT_DOMAIN="$client_domain"
HMS_TEST_HTTP_PORT="$local_port"
export COMPOSE_PROJECT_NAME CLIENT_DOMAIN HMS_TEST_HTTP_PORT

# Do not connect a seeded test stack until the hostname challenges anonymous
# requests. Access must cover the entire app, with no path exclusions.
if [ "$LOCAL_ONLY" = false ]; then
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

export ENV_FILE
COMPOSE_FILES="$ROOT_DIR/ops/compose-v2/compose.yml $KIT_DIR/compose.yml"
export COMPOSE_FILES
DATABASE_MODE=compose-postgres PUBLIC_HEALTHCHECK_MODE=skip \
  "$ROOT_DIR/ops/compose-v2/deploy.sh" --skip-pull
curl -fsS --connect-timeout 5 --max-time 10 \
  "http://127.0.0.1:$local_port/api/v2/health/ready" >/dev/null

if [ "$LOCAL_ONLY" = false ]; then
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/ops/compose-v2/compose.yml" \
    -f "$KIT_DIR/compose.yml" --profile tunnel up -d cloudflared
  tunnel_ready=false
  attempts=0
  while [ "$attempts" -lt 18 ]; do
    if docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/ops/compose-v2/compose.yml" \
      -f "$KIT_DIR/compose.yml" exec -T caddy \
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
  printf '%s\n' 'Origin ready; tunnel connected. Verify HTTPS login and test workflows through Cloudflare Access before calling the deployment live.'
else
  printf '%s\n' 'Synthetic origin ready on loopback. Public HTTPS and login verification remain pending.'
fi
