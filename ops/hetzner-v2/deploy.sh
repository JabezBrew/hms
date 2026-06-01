#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

if [ -z "${ENV_FILE+x}" ] && [ -f "$ROOT_DIR/ops/hetzner-v2/.env" ]; then
  ENV_FILE="$ROOT_DIR/ops/hetzner-v2/.env"
  export ENV_FILE
fi

printf 'ops/hetzner-v2/deploy.sh is deprecated; forwarding to ops/compose-v2/deploy.sh\n' >&2
exec "$ROOT_DIR/ops/compose-v2/deploy.sh" "$@"
