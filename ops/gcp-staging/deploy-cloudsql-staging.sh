#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

printf 'ops/gcp-staging/deploy-cloudsql-staging.sh is deprecated; forwarding to ops/gcp-staging/deploy.sh\n' >&2
exec "$ROOT_DIR/ops/gcp-staging/deploy.sh" "$@"
