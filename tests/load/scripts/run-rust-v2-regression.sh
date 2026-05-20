#!/usr/bin/env bash
set -euo pipefail

PROFILE="${HMS_LOAD_PROFILE:-stress}"
DATA_SCALE="${HMS_LOAD_DATA_SCALE:-current-seed}"
OUT_DIR="${HMS_LOAD_OUT_DIR:-results/load/rust-v2-${PROFILE}-$(date -u +%Y%m%dT%H%M%SZ)}"
SUMMARY_FILE="${OUT_DIR}/summary.json"
METRICS_BEFORE_FILE="${OUT_DIR}/api-metrics-before.prom"
METRICS_AFTER_FILE="${OUT_DIR}/api-metrics-after.prom"
REPORT_FILE="${OUT_DIR}/report.json"

mkdir -p "${OUT_DIR}"

if [[ -n "${HMS_LOAD_METRICS_URL:-}" ]]; then
  curl -fsS "${HMS_LOAD_METRICS_URL}" -o "${METRICS_BEFORE_FILE}"
fi

k6 run \
  --summary-export "${SUMMARY_FILE}" \
  -e "HMS_LOAD_PROFILE=${PROFILE}" \
  -e "HMS_LOAD_DATA_SCALE=${DATA_SCALE}" \
  tests/load/k6-rust-v2-realistic.js

REPORT_ARGS=(--summary "${SUMMARY_FILE}" --json-out "${REPORT_FILE}")

if [[ -n "${HMS_LOAD_METRICS_URL:-}" ]]; then
  curl -fsS "${HMS_LOAD_METRICS_URL}" -o "${METRICS_AFTER_FILE}"
  REPORT_ARGS+=(--metrics-before "${METRICS_BEFORE_FILE}" --metrics-after "${METRICS_AFTER_FILE}")
fi

node tests/load/scripts/report-rust-v2-performance.mjs "${REPORT_ARGS[@]}"

echo "summary=${SUMMARY_FILE}"
echo "report=${REPORT_FILE}"
