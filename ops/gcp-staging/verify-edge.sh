#!/usr/bin/env sh
set -eu

PROJECT="${GCP_PROJECT:-hms-perf-lab}"
ZONE="${GCP_ZONE:-africa-south1-a}"
DOMAIN="${GCP_STAGING_DOMAIN:-staging.thehms.systems}"
APP_INSTANCE="${GCP_APP_INSTANCE:-hms-gcp-app-1}"
APP_BACKEND="${GCP_APP_BACKEND:-hms-staging-app-backend}"
APP_HEALTH_CHECK="${GCP_APP_HEALTH_CHECK:-hms-staging-http-ready-hc}"
WEB_FIREWALL_RULE="${GCP_WEB_FIREWALL_RULE:-hms-perf-allow-web}"
EXPECTED_GFE_RANGES="${GCP_GFE_SOURCE_RANGES:-35.191.0.0/16,130.211.0.0/22}"
EXPECTED_TARGET_TAG="${GCP_APP_TARGET_TAG:-hms-perf-app}"
MODE="verify"

usage() {
  cat <<'EOF'
Usage: ops/gcp-staging/verify-edge.sh [--apply]

Verifies the current HMS GCP staging edge contract:
  - GCP HTTPS LB terminates public TLS.
  - App backend forwards HTTP to Caddy on named port http:80.
  - Backend health check is hms-staging-http-ready-hc.
  - VM web firewall allows only Google GFE/health-check ranges to tcp:80.
  - Public health and login routes work through the load balancer.
  - Direct public origin HTTP is blocked.

Options:
  --apply   Reconcile backend service and firewall rule before verification.
  --help    Show this help.

Environment overrides:
  GCP_PROJECT, GCP_ZONE, GCP_STAGING_DOMAIN, GCP_APP_INSTANCE,
  GCP_APP_BACKEND, GCP_APP_HEALTH_CHECK, GCP_WEB_FIREWALL_RULE,
  GCP_GFE_SOURCE_RANGES, GCP_APP_TARGET_TAG.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      MODE="apply"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

assert_eq() {
  name="$1"
  actual="$2"
  expected="$3"
  if [ "$actual" != "$expected" ]; then
    printf '%s mismatch: expected "%s", got "%s"\n' "$name" "$expected" "$actual" >&2
    exit 1
  fi
}

csv_contains_all_exactly() {
  actual_csv="$1"
  expected_csv="$2"
  old_ifs="$IFS"
  IFS=,
  set -- $expected_csv
  IFS="$old_ifs"
  for expected in "$@"; do
    case ",$actual_csv," in
      *,"$expected",*)
        ;;
      *)
        printf 'Missing expected source range: %s (actual: %s)\n' "$expected" "$actual_csv" >&2
        exit 1
        ;;
    esac
  done

  old_ifs="$IFS"
  IFS=,
  set -- $actual_csv
  IFS="$old_ifs"
  for actual in "$@"; do
    case ",$expected_csv," in
      *,"$actual",*)
        ;;
      *)
        printf 'Unexpected source range: %s (expected only: %s)\n' "$actual" "$expected_csv" >&2
        exit 1
        ;;
    esac
  done
}

require_command gcloud
require_command curl

if [ "$MODE" = "apply" ]; then
  printf 'Reconciling GCP edge backend service and web firewall...\n'
  gcloud --quiet compute backend-services update "$APP_BACKEND" \
    --global \
    --project "$PROJECT" \
    --protocol HTTP \
    --port-name http \
    --health-checks "$APP_HEALTH_CHECK" >/dev/null
  gcloud --quiet compute firewall-rules update "$WEB_FIREWALL_RULE" \
    --project "$PROJECT" \
    --source-ranges "$EXPECTED_GFE_RANGES" \
    --allow tcp:80 >/dev/null
fi

printf 'Verifying GCP edge contract for %s...\n' "$DOMAIN"

backend_protocol="$(
  gcloud compute backend-services describe "$APP_BACKEND" \
    --global \
    --project "$PROJECT" \
    --format='value(protocol)'
)"
backend_port_name="$(
  gcloud compute backend-services describe "$APP_BACKEND" \
    --global \
    --project "$PROJECT" \
    --format='value(portName)'
)"
backend_health_check="$(
  gcloud compute backend-services describe "$APP_BACKEND" \
    --global \
    --project "$PROJECT" \
    --format='value(healthChecks[0])'
)"

assert_eq "backend protocol" "$backend_protocol" "HTTP"
assert_eq "backend portName" "$backend_port_name" "http"
case "$backend_health_check" in
  */"$APP_HEALTH_CHECK")
    ;;
  *)
    printf 'backend health check mismatch: expected %s, got %s\n' "$APP_HEALTH_CHECK" "$backend_health_check" >&2
    exit 1
    ;;
esac

health_state="$(
  gcloud compute backend-services get-health "$APP_BACKEND" \
    --global \
    --project "$PROJECT" \
    --format='value(status.healthStatus[0].healthState)'
)"
health_port="$(
  gcloud compute backend-services get-health "$APP_BACKEND" \
    --global \
    --project "$PROJECT" \
    --format='value(status.healthStatus[0].port)'
)"
assert_eq "backend health state" "$health_state" "HEALTHY"
assert_eq "backend health port" "$health_port" "80"

firewall_ranges="$(
  gcloud compute firewall-rules describe "$WEB_FIREWALL_RULE" \
    --project "$PROJECT" \
    --format='csv[no-heading](sourceRanges[])' |
    tr ';' ',' |
    tr -d '[:space:]'
)"
firewall_allowed="$(
  gcloud compute firewall-rules describe "$WEB_FIREWALL_RULE" \
    --project "$PROJECT" \
    --format='value(allowed[0].IPProtocol,allowed[0].ports[0])' |
    tr '[:space:]' ' ' |
    sed 's/  */ /g; s/^ //; s/ $//'
)"
firewall_tags="$(
  gcloud compute firewall-rules describe "$WEB_FIREWALL_RULE" \
    --project "$PROJECT" \
    --format='csv[no-heading](targetTags[])' |
    tr ';' ',' |
    tr -d '[:space:]'
)"
csv_contains_all_exactly "$firewall_ranges" "$EXPECTED_GFE_RANGES"
assert_eq "firewall allowed" "$firewall_allowed" "tcp 80"
case ",$firewall_tags," in
  *,"$EXPECTED_TARGET_TAG",*)
    ;;
  *)
    printf 'firewall target tags missing %s (actual: %s)\n' "$EXPECTED_TARGET_TAG" "$firewall_tags" >&2
    exit 1
    ;;
esac

curl -fsS --max-time 30 "https://$DOMAIN/api/v2/health/ready" >/dev/null
curl -fsSI --max-time 30 "https://$DOMAIN/login" >/dev/null

origin_ip="$(
  gcloud compute instances describe "$APP_INSTANCE" \
    --zone "$ZONE" \
    --project "$PROJECT" \
    --format='value(networkInterfaces[0].accessConfigs[0].natIP)'
)"
if [ -z "$origin_ip" ]; then
  printf 'Could not determine public origin IP for %s.\n' "$APP_INSTANCE" >&2
  exit 1
fi

if curl -fsS --max-time 10 -H "Host: $DOMAIN" "http://$origin_ip/api/v2/health/ready" >/dev/null 2>&1; then
  printf 'Direct origin HTTP unexpectedly succeeded for %s (%s).\n' "$DOMAIN" "$origin_ip" >&2
  exit 1
fi

printf 'GCP edge verification passed: %s via HTTPS LB, backend healthy on http:80, origin HTTP blocked.\n' "$DOMAIN"
