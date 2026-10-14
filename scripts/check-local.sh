#!/bin/sh
# Local release checks, replacing the removed GitHub Actions jobs.
set -eu

task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
task_area=${1:-all}
case "$task_area" in
  all|frontend|backend|ops) ;;
  -h|--help)
    printf '%s\n' 'Usage: scripts/check-local.sh [all|frontend|backend|ops]' \
      'Start local Compose Postgres/Redis and configure their private credentials before backend checks.' \
      'Browser workflows and live deployment verification are additional checks.'
    exit 0 ;;
  *) printf 'Unknown check area: %s\n' "$task_area" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then printf 'Use --help for supported arguments.\n' >&2; exit 2; fi

if [ "$task_area" = all ] || [ "$task_area" = frontend ]; then
  (
    cd "$task_root/frontend"
    npm run lint
    npm run api:v2:generate:check
    npm run test:run
    npm run build
    npm run perf:bundle-budget
  )
fi

if [ "$task_area" = all ] || [ "$task_area" = backend ]; then
  (
    cd "$task_root/backend-rs"
    cargo fmt --all --check
    cargo test --locked --workspace -- --test-threads=4
    task_openapi=$(mktemp)
    trap 'rm -f "$task_openapi"' EXIT HUP INT TERM
    cargo run --locked -p hms-api --bin hms-openapi -- "$task_openapi"
    cmp openapi/hms-v2.openapi.json "$task_openapi"
  )
fi

if [ "$task_area" = all ] || [ "$task_area" = ops ]; then
  (cd "$task_root" && python3 -m pytest ops/tests -q)
fi

printf 'Local %s checks passed.\n' "$task_area"
