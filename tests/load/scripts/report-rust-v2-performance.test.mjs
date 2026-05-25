import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const REPORT_SCRIPT = path.join(SCRIPT_DIR, 'report-rust-v2-performance.mjs');
const RUNNER_SCRIPT = path.join(SCRIPT_DIR, 'run-rust-v2-regression.sh');

test('report passes when k6 and server metrics stay within baseline', () => {
  const fixture = createFixture();
  const result = runReport(fixture);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readReport(fixture).status, 'pass');
});

test('report warns when p99 drifts above the baseline tolerance but below the fail tolerance', () => {
  const fixture = createFixture({ p99: 55 });
  const result = runReport(fixture);
  const report = readReport(fixture);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(report.status, 'warn');
  assert.match(report.warnings.join('\n'), /Auth\/me p99 55ms regressed/);
});

test('report fails when p99 materially regresses even below the absolute route budget', () => {
  const fixture = createFixture({ p99: 74 });
  const result = runReport(fixture);
  const report = readReport(fixture);

  assert.equal(result.status, 1);
  assert.equal(report.status, 'fail');
  assert.match(report.failures.join('\n'), /Auth\/me p99 74ms regressed/);
});

test('report is incomplete when metrics are missing in regression mode', () => {
  const fixture = createFixture();
  const result = runReport(fixture, { includeMetrics: false });
  const report = readReport(fixture);

  assert.equal(result.status, 2);
  assert.equal(report.status, 'incomplete');
  assert.match(report.incomplete.join('\n'), /Prometheus metrics were not provided/);
});

test('report fails when the auth freshness query reappears', () => {
  const fixture = createFixture({ authVersionQueries: 1 });
  const result = runReport(fixture);
  const report = readReport(fixture);

  assert.equal(result.status, 1);
  assert.equal(report.status, 'fail');
  assert.match(report.failures.join('\n'), /auth_invalidation_versions count 1 exceeded budget 0/);
});

test('report fails when route payload p99 exceeds the budget', () => {
  const fixture = createFixture({ payloadUpperBoundBytes: 262_144 });
  const result = runReport(fixture);
  const report = readReport(fixture);

  assert.equal(result.status, 1);
  assert.equal(report.status, 'fail');
  assert.match(report.failures.join('\n'), /Auth\/me payload p9[59] .* exceeded budget/);
});

test('report fails when DB pool wait p99 exceeds the budget', () => {
  const fixture = createFixture({ poolWaitUpperBoundSeconds: 0.05 });
  const result = runReport(fixture);
  const report = readReport(fixture);

  assert.equal(result.status, 1);
  assert.equal(report.status, 'fail');
  assert.match(report.failures.join('\n'), /Auth\/me DB pool wait p9[59] .* exceeded budget/);
});

test('report fails when route slow SQL exceeds the budget', () => {
  const fixture = createFixture({ slowQueries: 1 });
  const result = runReport(fixture);
  const report = readReport(fixture);

  assert.equal(result.status, 1);
  assert.equal(report.status, 'fail');
  assert.match(report.failures.join('\n'), /Auth\/me slow SQL\/query request ratio/);
});

test('runner still writes a report when k6 exits nonzero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-perf-runner-'));
  const fakeBin = path.join(dir, 'bin');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(
    path.join(fakeBin, 'k6'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const summaryPath = args[args.indexOf('--summary-export') + 1];
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, ${JSON.stringify(JSON.stringify(fullSummary()))});
process.exit(99);
`
  );
  fs.chmodSync(path.join(fakeBin, 'k6'), 0o755);

  const result = spawnSync('bash', [RUNNER_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      HMS_LOAD_OUT_DIR: outDir,
      HMS_LOAD_ALLOW_MISSING_METRICS: 'true',
    },
  });

  assert.equal(result.status, 99, result.stderr || result.stdout);
  assert.ok(fs.existsSync(path.join(outDir, 'summary.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'report.json')));
});

function createFixture({
  p99 = 45,
  authVersionQueries = 0,
  payloadUpperBoundBytes = 4096,
  poolWaitUpperBoundSeconds = 0.001,
  slowQueries = 0,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-perf-report-'));
  const baselinePath = path.join(dir, 'baseline.json');
  const summaryPath = path.join(dir, 'summary.json');
  const metricsBeforePath = path.join(dir, 'metrics-before.prom');
  const metricsAfterPath = path.join(dir, 'metrics-after.prom');
  const reportPath = path.join(dir, 'report.json');

  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({
      schema_version: 1,
      name: 'test-baseline',
      budgets: {
        checks_failure_rate_max: 0,
        http_failure_rate_max: 0,
        hms_error_rate_max: 0,
        p99_regression_warn_ratio: 1.2,
        p99_regression_fail_ratio: 1.5,
        pool: {
          postgres_used_ratio_max: 0.9,
          auth_postgres_used_ratio_max: 0.9,
          min_idle_connections: 1,
        },
      },
      surfaces: [
        {
          id: 'auth_me',
          label: 'Auth/me',
          k6_metric: 'hms_auth_me',
          method: 'GET',
          route: '/api/v2/auth/me',
          status: '200',
          p99_ms_budget: 75,
          payload_p95_bytes_budget: 8192,
          payload_p99_bytes_budget: 16384,
          db_pool_wait_p95_ms_budget: 5,
          db_pool_wait_p99_ms_budget: 25,
          slow_queries_per_request_max: 0,
          observed_p99_ms: 45,
          db_queries_per_request_max: 0,
        },
      ],
      db_query_guards: [
        {
          id: 'auth_invalidation_versions',
          query: 'auth.user_auth_versions_for_facility',
          max_delta: 0,
          severity: 'fail',
        },
      ],
    })}\n`
  );

  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify({
      metrics: {
        checks: { passes: 100, fails: 0, value: 1 },
        http_req_failed: { passes: 0, fails: 100, value: 0 },
        hms_errors: { passes: 0, fails: 100, value: 0 },
        hms_auth_me: { 'p(99)': p99 },
      },
    })}\n`
  );

  fs.writeFileSync(
    metricsBeforePath,
    prometheusText({
      authRequests: 0,
      authDbQueries: 0,
      authVersionQueries: 0,
    })
  );
  fs.writeFileSync(
    metricsAfterPath,
    prometheusText({
      authRequests: 100,
      authDbQueries: 0,
      authVersionQueries,
      payloadUpperBoundBytes,
      poolWaitUpperBoundSeconds,
      slowQueries,
    })
  );

  return { baselinePath, summaryPath, metricsBeforePath, metricsAfterPath, reportPath };
}

function runReport(fixture, { includeMetrics = true } = {}) {
  const args = [
    REPORT_SCRIPT,
    '--baseline',
    fixture.baselinePath,
    '--summary',
    fixture.summaryPath,
    '--json-out',
    fixture.reportPath,
  ];
  if (includeMetrics) {
    args.push('--metrics-before', fixture.metricsBeforePath, '--metrics-after', fixture.metricsAfterPath);
  }
  return spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function readReport(fixture) {
  return JSON.parse(fs.readFileSync(fixture.reportPath, 'utf8'));
}

function prometheusText({
  authRequests,
  authDbQueries,
  authVersionQueries,
  payloadUpperBoundBytes = 4096,
  poolWaitUpperBoundSeconds = 0.001,
  slowQueries = 0,
}) {
  return `hms_api_http_requests_total{method="GET",route="/api/v2/auth/me",status="200"} ${authRequests}
hms_api_http_db_query_count_sum{method="GET",route="/api/v2/auth/me",status="200"} ${authDbQueries}
hms_db_query_duration_seconds_count{query="auth.user_auth_versions_for_facility"} ${authVersionQueries}
${histogramText('hms_api_response_payload_bytes', payloadUpperBoundBytes, authRequests)}
${histogramText('hms_db_pool_wait_seconds', poolWaitUpperBoundSeconds, authRequests)}
hms_db_slow_query_total{route_pattern="/api/v2/auth/me",status_bucket="2xx",facility_safe="HMS"} ${slowQueries}
hms_api_postgres_pool_size 10
hms_api_postgres_pool_idle 10
hms_api_auth_postgres_pool_size 4
hms_api_auth_postgres_pool_idle 4
`;
}

function histogramText(metricName, upperBound, count) {
  const bounds = metricName === 'hms_api_response_payload_bytes'
    ? [1024, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576]
    : [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5];
  const lines = bounds.map((bound) => {
    const bucketCount = bound >= upperBound ? count : 0;
    return `${metricName}_bucket{route_pattern="/api/v2/auth/me",status_bucket="2xx",facility_safe="HMS",le="${bound}"} ${bucketCount}`;
  });
  lines.push(`${metricName}_bucket{route_pattern="/api/v2/auth/me",status_bucket="2xx",facility_safe="HMS",le="+Inf"} ${count}`);
  lines.push(`${metricName}_sum{route_pattern="/api/v2/auth/me",status_bucket="2xx",facility_safe="HMS"} ${upperBound * count}`);
  lines.push(`${metricName}_count{route_pattern="/api/v2/auth/me",status_bucket="2xx",facility_safe="HMS"} ${count}`);
  return lines.join('\n');
}

function fullSummary() {
  return {
    metrics: {
      checks: { passes: 100, fails: 0, value: 1 },
      http_req_failed: { passes: 0, fails: 100, value: 0 },
      hms_errors: { passes: 0, fails: 100, value: 0 },
      hms_auth_me: { 'p(99)': 44.969201250000054 },
      hms_patient_list: { 'p(99)': 87.51319561999989 },
      hms_patient_chronicle: { 'p(99)': 62.07690775000001 },
      hms_search: { 'p(99)': 91.10639380000033 },
      hms_ward_board: { 'p(99)': 44.874755079999765 },
      hms_dashboard_snapshot: { 'p(99)': 50 },
      hms_laboratory: { 'p(99)': 52.631584040000064 },
      hms_inventory: { 'p(99)': 70.10218857999999 },
      hms_billing: { 'p(99)': 55.18153020000005 },
    },
  };
}
