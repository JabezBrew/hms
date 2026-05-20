#!/usr/bin/env bash
set -euo pipefail

PROFILE="${HMS_LOAD_PROFILE:-stress}"
DATA_SCALE="${HMS_LOAD_DATA_SCALE:-current-seed}"
OUT_DIR="${HMS_LOAD_OUT_DIR:-results/load/rust-v2-${PROFILE}-$(date -u +%Y%m%dT%H%M%SZ)}"
SUMMARY_FILE="${OUT_DIR}/summary.json"
METRICS_BEFORE_FILE="${OUT_DIR}/api-metrics-before.prom"
METRICS_AFTER_FILE="${OUT_DIR}/api-metrics-after.prom"
REPORT_FILE="${OUT_DIR}/report.json"
METRICS_BEFORE_AVAILABLE=0
METRICS_AFTER_AVAILABLE=0

mkdir -p "${OUT_DIR}"

if [[ -n "${HMS_LOAD_METRICS_URL:-}" ]]; then
  if curl -fsS "${HMS_LOAD_METRICS_URL}" -o "${METRICS_BEFORE_FILE}"; then
    METRICS_BEFORE_AVAILABLE=1
  else
    echo "warning: failed to scrape before metrics from HMS_LOAD_METRICS_URL" >&2
  fi
fi

K6_EXIT=0
k6 run \
  --summary-export "${SUMMARY_FILE}" \
  -e "HMS_LOAD_PROFILE=${PROFILE}" \
  -e "HMS_LOAD_DATA_SCALE=${DATA_SCALE}" \
  tests/load/k6-rust-v2-realistic.js || K6_EXIT=$?

REPORT_ARGS=(--summary "${SUMMARY_FILE}" --json-out "${REPORT_FILE}")

if [[ -n "${HMS_LOAD_METRICS_URL:-}" ]]; then
  if curl -fsS "${HMS_LOAD_METRICS_URL}" -o "${METRICS_AFTER_FILE}"; then
    METRICS_AFTER_AVAILABLE=1
  else
    echo "warning: failed to scrape after metrics from HMS_LOAD_METRICS_URL" >&2
  fi
fi

if [[ "${METRICS_AFTER_AVAILABLE}" -eq 1 ]]; then
  if [[ "${METRICS_BEFORE_AVAILABLE}" -eq 1 ]]; then
    REPORT_ARGS+=(--metrics-before "${METRICS_BEFORE_FILE}")
  fi
  REPORT_ARGS+=(--metrics-after "${METRICS_AFTER_FILE}")
fi

case "${HMS_LOAD_ALLOW_MISSING_METRICS:-false}" in
  1|true|TRUE|yes|YES)
    REPORT_ARGS+=(--allow-missing-metrics)
    ;;
esac

REPORT_EXIT=0
if [[ -f "${SUMMARY_FILE}" ]]; then
  node tests/load/scripts/report-rust-v2-performance.mjs "${REPORT_ARGS[@]}" || REPORT_EXIT=$?
else
  echo "error: k6 did not write ${SUMMARY_FILE}; skipping performance report." >&2
  REPORT_EXIT=2
fi

echo "summary=${SUMMARY_FILE}"
echo "report=${REPORT_FILE}"

if [[ "${REPORT_EXIT}" -ne 0 ]]; then
  exit "${REPORT_EXIT}"
fi

if [[ "${K6_EXIT}" -ne 0 ]]; then
  exit "${K6_EXIT}"
fi
