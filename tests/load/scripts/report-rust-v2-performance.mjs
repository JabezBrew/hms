#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASELINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../baselines/rust-v2-vps-edge-https-stress-after-auth-invalidation-cache.json'
);

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

if (!args.summary) {
  printHelp();
  process.exitCode = 2;
} else {
  const baselinePath = path.resolve(args.baseline || DEFAULT_BASELINE);
  const summaryPath = path.resolve(args.summary);
  const metricsAfterPath = (args.metricsAfter || args.metrics)
    ? path.resolve(args.metricsAfter || args.metrics)
    : null;
  const metricsBeforePath = args.metricsBefore ? path.resolve(args.metricsBefore) : null;
  const jsonOutPath = args.jsonOut ? path.resolve(args.jsonOut) : null;
  const allowMissingMetrics = Boolean(args.allowMissingMetrics);

  const baseline = readJson(baselinePath);
  const summary = readJson(summaryPath);
  const metricsBefore = metricsBeforePath ? parsePrometheus(readText(metricsBeforePath)) : null;
  const metricsAfter = metricsAfterPath ? parsePrometheus(readText(metricsAfterPath)) : null;
  const report = buildReport({
    baseline,
    baselinePath,
    summary,
    summaryPath,
    metricsBefore,
    metricsBeforePath,
    metricsAfter,
    metricsAfterPath,
    allowMissingMetrics,
  });

  printReport(report);

  if (jsonOutPath) {
    fs.writeFileSync(jsonOutPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  process.exitCode = report.status === 'fail' ? 1 : report.status === 'incomplete' ? 2 : 0;
}

function buildReport(input) {
  const failures = [];
  const warnings = [];
  const incompletes = [];
  const budgets = input.baseline.budgets || {};
  const summaryChecks = summarizeChecks(input.summary, budgets, failures, incompletes);
  const summaryFailures = summarizeFailures(input.summary, budgets, failures, incompletes);
  const latency = summarizeLatency(input.baseline, input.summary, failures, warnings, incompletes);
  const server = summarizeServerMetrics(
    input.baseline,
    input.metricsBefore,
    input.metricsAfter,
    failures,
    warnings,
    incompletes,
    input.allowMissingMetrics
  );
  const pool = summarizePool(input.baseline, input.metricsAfter, failures, warnings, incompletes);
  const guards = summarizeQueryGuards(input.baseline, input.metricsBefore, input.metricsAfter, failures, warnings, incompletes);
  const status = reportStatus({ failures, warnings, incompletes, latency, server, pool, guards });

  return {
    schema_version: 1,
    status,
    baseline: {
      name: input.baseline.name,
      path: input.baselinePath,
      captured_at: input.baseline.captured_at,
      environment: input.baseline.environment,
    },
    inputs: {
      summary: input.summaryPath,
      metrics_before: input.metricsBeforePath,
      metrics_after: input.metricsAfterPath,
      metrics_mode: input.metricsAfter
        ? input.metricsBefore
          ? 'counter_delta'
          : 'cumulative_snapshot'
        : 'not_provided',
    },
    k6: {
      checks: summaryChecks,
      failures: summaryFailures,
      latency,
    },
    server,
    pool,
    guards,
    warnings,
    incomplete: incompletes,
    failures,
  };
}

function reportStatus({ failures, warnings, incompletes, latency, server, pool, guards }) {
  if (failures.length > 0) return 'fail';
  if (incompletes.length > 0) return 'incomplete';
  if (
    warnings.length > 0
    || latency.some((row) => row.status === 'warn')
    || server.surfaces?.some((row) => row.status === 'warn')
    || pool.checks?.some((row) => row.status === 'warn')
    || guards.checks?.some((row) => row.status === 'warn')
  ) {
    return 'warn';
  }
  return 'pass';
}

function summarizeChecks(summary, budgets, failures, incompletes) {
  const checks = summary.metrics?.checks;
  if (!checks) {
    incompletes.push('k6 checks metric was missing from the summary.');
    return { passes: 0, failed: 0, total: 0, failure_rate: null, budget_max: numberOrZero(budgets.checks_failure_rate_max), status: 'incomplete' };
  }

  const passes = numberOrZero(checks.passes);
  const failed = numberOrZero(checks.fails);
  const total = passes + failed;
  const failureRate = total > 0 ? failed / total : 0;
  const max = numberOrZero(budgets.checks_failure_rate_max);
  let status = failureRate <= max ? 'pass' : 'fail';

  if (total === 0) {
    status = 'incomplete';
    incompletes.push('k6 checks metric had zero samples.');
  }

  if (status === 'fail') {
    failures.push(`checks failure rate ${formatPercent(failureRate)} exceeded budget ${formatPercent(max)}`);
  }

  return { passes, failed, total, failure_rate: failureRate, budget_max: max, status };
}

function summarizeFailures(summary, budgets, failures, incompletes) {
  const hasHttpMetric = Boolean(summary.metrics?.http_req_failed);
  const hasHmsMetric = Boolean(summary.metrics?.hms_errors);
  const httpRate = rateValue(summary.metrics?.http_req_failed);
  const hmsRate = rateValue(summary.metrics?.hms_errors);
  const httpMax = numberOrZero(budgets.http_failure_rate_max);
  const hmsMax = numberOrZero(budgets.hms_error_rate_max);
  let httpStatus = httpRate <= httpMax ? 'pass' : 'fail';
  let hmsStatus = hmsRate <= hmsMax ? 'pass' : 'fail';

  if (!hasHttpMetric) {
    httpStatus = 'incomplete';
    incompletes.push('k6 http_req_failed metric was missing from the summary.');
  }
  if (!hasHmsMetric) {
    hmsStatus = 'incomplete';
    incompletes.push('k6 hms_errors metric was missing from the summary.');
  }

  if (httpStatus === 'fail') {
    failures.push(`http_req_failed ${formatPercent(httpRate)} exceeded budget ${formatPercent(httpMax)}`);
  }
  if (hmsStatus === 'fail') {
    failures.push(`hms_errors ${formatPercent(hmsRate)} exceeded budget ${formatPercent(hmsMax)}`);
  }

  return {
    http_req_failed: { rate: httpRate, budget_max: httpMax, status: httpStatus },
    hms_errors: { rate: hmsRate, budget_max: hmsMax, status: hmsStatus },
  };
}

function summarizeLatency(baseline, summary, failures, warnings, incompletes) {
  const budgets = baseline.budgets || {};
  const defaultWarnRatio = numeric(budgets.p99_regression_warn_ratio) ?? 1.2;
  const defaultFailRatio = numeric(budgets.p99_regression_fail_ratio) ?? 1.5;

  return (baseline.surfaces || []).map((surface) => {
    const metric = summary.metrics?.[surface.k6_metric];
    const p99 = metric ? numeric(metric['p(99)']) : null;
    const budget = numeric(surface.p99_ms_budget);
    const baselineP99 = numeric(surface.observed_p99_ms);
    const warnRatio = numeric(surface.p99_regression_warn_ratio) ?? defaultWarnRatio;
    const failRatio = numeric(surface.p99_regression_fail_ratio) ?? defaultFailRatio;
    const regressionRatio = p99 !== null && baselineP99 !== null && baselineP99 > 0 ? p99 / baselineP99 : null;
    let status = 'pass';
    let note = '';

    if (p99 === null) {
      status = surface.missing_k6_metric === 'warn' ? 'warn' : 'incomplete';
      note = `missing k6 metric ${surface.k6_metric}`;
      if (status === 'warn') {
        warnings.push(`${surface.label}: ${note}`);
      } else {
        incompletes.push(`${surface.label} is missing required k6 metric ${surface.k6_metric}`);
      }
    } else if (budget !== null && p99 > budget) {
      status = 'fail';
      failures.push(`${surface.label} p99 ${formatMs(p99)} exceeded budget ${formatMs(budget)}`);
    } else if (regressionRatio !== null && regressionRatio > failRatio) {
      status = 'fail';
      failures.push(`${surface.label} p99 ${formatMs(p99)} regressed ${formatNumber(regressionRatio)}x from baseline ${formatMs(baselineP99)}`);
    } else if (regressionRatio !== null && regressionRatio > warnRatio) {
      status = 'warn';
      warnings.push(`${surface.label} p99 ${formatMs(p99)} regressed ${formatNumber(regressionRatio)}x from baseline ${formatMs(baselineP99)}`);
    }

    return {
      id: surface.id,
      label: surface.label,
      metric: surface.k6_metric,
      p99_ms: p99,
      budget_ms: budget,
      observed_baseline_p99_ms: baselineP99,
      regression_ratio: regressionRatio,
      regression_warn_ratio: warnRatio,
      regression_fail_ratio: failRatio,
      status,
      note,
    };
  });
}

function summarizeServerMetrics(baseline, before, after, failures, warnings, incompletes, allowMissingMetrics) {
  if (!after) {
    const message = 'Prometheus metrics were not provided; route DB-query budgets and pool pressure were not evaluated.';
    if (allowMissingMetrics) {
      warnings.push(message);
    } else {
      incompletes.push(`${message} Pass --allow-missing-metrics only for k6-only smoke reporting.`);
    }
    return { available: false, mode: 'not_provided', surfaces: [] };
  }

  const mode = before ? 'counter_delta' : 'cumulative_snapshot';
  if (!before) {
    warnings.push('Only one Prometheus metrics snapshot was provided; counter values are cumulative for the API process, not isolated run deltas.');
  }

  const surfaces = (baseline.surfaces || []).map((surface) => {
    const routes = surface.routes || [surface.route];
    const method = surface.method;
    const statusCode = surface.status || '200';
    const requestCount = sumCounterDelta(before, after, 'hms_api_http_requests_total', routes, method, statusCode, warnings);
    const dbQueries = sumCounterDelta(before, after, 'hms_api_http_db_query_count_sum', routes, method, statusCode, warnings);
    const perRequest = requestCount > 0 ? dbQueries / requestCount : null;
    const budget = numeric(surface.db_queries_per_request_max);
    let status = 'pass';
    let note = '';

    if (requestCount === 0) {
      status = 'incomplete';
      note = 'no matching server route requests found';
      incompletes.push(`${surface.label}: ${note}`);
    } else if (budget !== null && perRequest !== null && perRequest > budget) {
      status = 'fail';
      failures.push(`${surface.label} DB queries/request ${formatNumber(perRequest)} exceeded budget ${formatNumber(budget)}`);
    }

    return {
      id: surface.id,
      label: surface.label,
      method,
      routes,
      status_code: statusCode,
      requests: requestCount,
      db_queries: dbQueries,
      db_queries_per_request: perRequest,
      budget_db_queries_per_request: budget,
      status,
      note,
    };
  });

  return { available: true, mode, surfaces };
}

function summarizePool(baseline, metrics, failures, warnings, incompletes) {
  if (!metrics) {
    return { available: false, status: 'warn', note: 'Prometheus metrics were not provided.' };
  }

  const poolBudget = baseline.budgets?.pool || {};
  const postgresSize = gauge(metrics, 'hms_api_postgres_pool_size');
  const postgresIdle = gauge(metrics, 'hms_api_postgres_pool_idle');
  const authSize = gauge(metrics, 'hms_api_auth_postgres_pool_size');
  const authIdle = gauge(metrics, 'hms_api_auth_postgres_pool_idle');
  const minIdle = numeric(poolBudget.min_idle_connections) ?? 1;
  const maxPostgresUsed = numeric(poolBudget.postgres_used_ratio_max) ?? 0.9;
  const maxAuthUsed = numeric(poolBudget.auth_postgres_used_ratio_max) ?? 0.9;
  const postgresUsedRatio = usedRatio(postgresSize, postgresIdle);
  const authUsedRatio = usedRatio(authSize, authIdle);
  const checks = [];

  addPoolCheck(checks, failures, incompletes, 'postgres', postgresSize, postgresIdle, postgresUsedRatio, minIdle, maxPostgresUsed);
  addPoolCheck(checks, failures, incompletes, 'auth_postgres', authSize, authIdle, authUsedRatio, minIdle, maxAuthUsed);

  if (checks.some((check) => check.status === 'missing')) {
    incompletes.push('Pool gauges were incomplete in the Prometheus metrics snapshot.');
  }

  return {
    available: true,
    note: 'Pool pressure is evaluated from the supplied metrics snapshot. Use Grafana/Prometheus range queries for peak pressure during the run.',
    checks,
    status: checks.some((check) => check.status === 'fail') ? 'fail' : 'pass',
  };
}

function summarizeQueryGuards(baseline, before, after, failures, warnings, incompletes) {
  if (!after) {
    return { available: false, checks: [] };
  }

  return {
    available: true,
    checks: (baseline.db_query_guards || []).map((guard) => {
      const count = sumQueryCounterDelta(before, after, guard.query, warnings);
      let denominator = null;
      let value = count;
      let budget = numeric(guard.max_delta);

      if (guard.route && guard.max_per_route_request !== undefined) {
        denominator = sumCounterDelta(before, after, 'hms_api_http_requests_total', [guard.route], guard.method || 'GET', guard.status || '200', warnings);
        value = denominator > 0 ? count / denominator : null;
        budget = numeric(guard.max_per_route_request);
      }

      let status = 'pass';
      if (value === null) {
        status = 'incomplete';
        incompletes.push(`${guard.id}: route denominator was zero; guard could not be evaluated.`);
      } else if (budget !== null && value > budget) {
        status = guard.severity === 'warn' ? 'warn' : 'fail';
        const message = guard.route
          ? `${guard.id} ${formatNumber(value)} per route request exceeded budget ${formatNumber(budget)}`
          : `${guard.id} count ${formatNumber(value)} exceeded budget ${formatNumber(budget)}`;
        if (status === 'fail') {
          failures.push(message);
        } else {
          warnings.push(message);
        }
      }

      return {
        id: guard.id,
        query: guard.query,
        count,
        denominator,
        value,
        budget,
        severity: guard.severity || 'fail',
        status,
        notes: guard.notes || '',
      };
    }),
  };
}

function addPoolCheck(checks, failures, incompletes, label, size, idle, used, minIdle, maxUsed) {
  if (size === null || idle === null || used === null) {
    checks.push({ pool: label, status: 'missing', size, idle, used_ratio: used });
    incompletes.push(`${label} pool gauges were missing or incomplete.`);
    return;
  }

  const status = idle >= minIdle && used <= maxUsed ? 'pass' : 'fail';
  if (status === 'fail') {
    failures.push(`${label} pool pressure failed: idle=${idle}, used_ratio=${formatPercent(used)}, budgets idle>=${minIdle}, used<=${formatPercent(maxUsed)}`);
  }

  checks.push({
    pool: label,
    status,
    size,
    idle,
    used_ratio: used,
    budget_min_idle: minIdle,
    budget_max_used_ratio: maxUsed,
  });
}

function sumCounterDelta(before, after, metricName, routes, method, status, warnings) {
  let total = 0;
  for (const route of routes) {
    total += counterDelta(before, after, metricName, { method, route, status }, warnings);
  }
  return total;
}

function sumQueryCounterDelta(before, after, query, warnings) {
  return counterDelta(before, after, 'hms_db_query_duration_seconds_count', { query }, warnings);
}

function counterDelta(before, after, metricName, labels, warnings) {
  const afterValue = metricValue(after, metricName, labels);
  if (afterValue === null) return 0;
  if (!before) return afterValue;

  const beforeValue = metricValue(before, metricName, labels) || 0;
  const delta = afterValue - beforeValue;
  if (delta < 0) {
    warnings.push(`${metricName}${formatLabelSelector(labels)} decreased; treating after value as a counter reset.`);
    return afterValue;
  }
  return delta;
}

function metricValue(metrics, metricName, labels) {
  const samples = metrics.get(metricName) || [];
  for (const sample of samples) {
    if (labelsMatch(sample.labels, labels)) return sample.value;
  }
  return null;
}

function gauge(metrics, name) {
  const samples = metrics.get(name) || [];
  return samples.length > 0 ? samples[0].value : null;
}

function usedRatio(size, idle) {
  if (size === null || idle === null || size <= 0) return null;
  return (size - idle) / size;
}

function labelsMatch(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== String(value)) return false;
  }
  return true;
}

function parsePrometheus(text) {
  const metrics = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = parsePrometheusLine(line);
    if (!parsed) continue;
    if (!metrics.has(parsed.name)) metrics.set(parsed.name, []);
    metrics.get(parsed.name).push(parsed);
  }
  return metrics;
}

function parsePrometheusLine(line) {
  const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|NaN|\+Inf|-Inf)(?:\s+\d+)?$/);
  if (!match) return null;
  return {
    name: match[1],
    labels: match[2] ? parseLabels(match[2]) : {},
    value: Number(match[3]),
  };
}

function parseLabels(input) {
  const labels = {};
  let index = 0;
  while (index < input.length) {
    while (input[index] === ' ' || input[index] === ',') index += 1;
    const keyStart = index;
    while (index < input.length && input[index] !== '=') index += 1;
    const key = input.slice(keyStart, index);
    index += 1;
    if (input[index] !== '"') break;
    index += 1;
    let value = '';
    while (index < input.length) {
      const char = input[index];
      if (char === '\\') {
        const next = input[index + 1];
        value += next === 'n' ? '\n' : next;
        index += 2;
        continue;
      }
      if (char === '"') {
        index += 1;
        break;
      }
      value += char;
      index += 1;
    }
    labels[key] = value;
    while (input[index] === ' ' || input[index] === ',') index += 1;
  }
  return labels;
}

function printReport(report) {
  const lines = [];
  lines.push('HMS Rust V2 Performance Regression Report');
  lines.push(`Status: ${report.status.toUpperCase()}`);
  lines.push(`Baseline: ${report.baseline.name}`);
  lines.push(`Summary: ${report.inputs.summary}`);
  lines.push(`Metrics: ${report.inputs.metrics_mode}`);
  lines.push('');
  lines.push('K6 checks and failures');
  lines.push(`- checks: ${report.k6.checks.passes} passed, ${report.k6.checks.failed} failed (${formatPercent(report.k6.checks.failure_rate)}), budget <= ${formatPercent(report.k6.checks.budget_max)} [${report.k6.checks.status}]`);
  lines.push(`- http_req_failed: ${formatPercent(report.k6.failures.http_req_failed.rate)}, budget <= ${formatPercent(report.k6.failures.http_req_failed.budget_max)} [${report.k6.failures.http_req_failed.status}]`);
  lines.push(`- hms_errors: ${formatPercent(report.k6.failures.hms_errors.rate)}, budget <= ${formatPercent(report.k6.failures.hms_errors.budget_max)} [${report.k6.failures.hms_errors.status}]`);
  lines.push('');
  lines.push('Hot-route p99 budgets and baseline drift');
  lines.push(table(
    ['Surface', 'Metric', 'p99', 'Baseline', 'Drift', 'Budget', 'Status'],
    report.k6.latency.map((row) => [
      row.label,
      row.metric,
      row.p99_ms === null ? 'n/a' : formatMs(row.p99_ms),
      row.observed_baseline_p99_ms === null ? 'n/a' : formatMs(row.observed_baseline_p99_ms),
      row.regression_ratio === null ? 'n/a' : `${formatNumber(row.regression_ratio)}x`,
      row.budget_ms === null ? 'n/a' : formatMs(row.budget_ms),
      row.status,
    ])
  ));

  if (report.server.available) {
    lines.push('');
    lines.push(`Server route DB-query budgets (${report.server.mode})`);
    lines.push(table(
      ['Surface', 'Requests', 'DB queries', 'Queries/request', 'Budget', 'Status'],
      report.server.surfaces.map((row) => [
        row.label,
        formatNumber(row.requests),
        formatNumber(row.db_queries),
        row.db_queries_per_request === null ? 'n/a' : formatNumber(row.db_queries_per_request),
        row.budget_db_queries_per_request === null ? 'n/a' : formatNumber(row.budget_db_queries_per_request),
        row.status,
      ])
    ));
  }

  if (report.pool.available) {
    lines.push('');
    lines.push('Pool snapshot');
    lines.push(report.pool.note);
    lines.push(table(
      ['Pool', 'Size', 'Idle', 'Used', 'Budget', 'Status'],
      report.pool.checks.map((row) => [
        row.pool,
        row.size === null ? 'n/a' : formatNumber(row.size),
        row.idle === null ? 'n/a' : formatNumber(row.idle),
        row.used_ratio === null ? 'n/a' : formatPercent(row.used_ratio),
        row.budget_max_used_ratio === undefined ? 'n/a' : `idle>=${row.budget_min_idle}, used<=${formatPercent(row.budget_max_used_ratio)}`,
        row.status,
      ])
    ));
  }

  if (report.guards.available) {
    lines.push('');
    lines.push('Guardrails');
    lines.push(table(
      ['Guard', 'Query', 'Value', 'Budget', 'Severity', 'Status'],
      report.guards.checks.map((row) => [
        row.id,
        row.query,
        row.value === null ? 'n/a' : formatNumber(row.value),
        row.budget === null ? 'n/a' : formatNumber(row.budget),
        row.severity,
        row.status,
      ])
    ));
  }

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  if (report.incomplete.length > 0) {
    lines.push('');
    lines.push('Incomplete Evidence');
    for (const incomplete of report.incomplete) lines.push(`- ${incomplete}`);
  }

  if (report.failures.length > 0) {
    lines.push('');
    lines.push('Failures');
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }

  console.log(lines.join('\n'));
}

function table(headers, rows) {
  const widths = headers.map((header, index) => {
    const cells = rows.map((row) => String(row[index] ?? ''));
    return Math.max(String(header).length, ...cells.map((cell) => cell.length));
  });
  const formatRow = (row) => row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ');
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  return [formatRow(headers), divider, ...rows.map(formatRow)].join('\n');
}

function rateValue(metric) {
  if (!metric) return 0;
  if (typeof metric.value === 'number') return metric.value;
  const passes = numberOrZero(metric.passes);
  const fails = numberOrZero(metric.fails);
  const total = passes + fails;
  return total > 0 ? passes / total : 0;
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const name = toCamel(arg.slice(2));
    if (name === 'help' || name === 'h' || name === 'allowMissingMetrics') {
      parsed[name] = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[name] = next;
    index += 1;
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrZero(value) {
  return numeric(value) ?? 0;
}

function formatMs(value) {
  return `${formatNumber(value)}ms`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return `${formatNumber(value * 100)}%`;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 10) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function formatLabelSelector(labels) {
  const body = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(',');
  return `{${body}}`;
}

function printHelp() {
  console.log(`Usage:
  node tests/load/scripts/report-rust-v2-performance.mjs \\
    --summary /tmp/hms-load-results/vps-edge-https-stress-after-auth-invalidation-cache.json \\
    --metrics-after /tmp/hms-api-after.prom

Options:
  --summary FILE          k6 --summary-export JSON. Required.
  --baseline FILE         Performance baseline JSON. Defaults to the committed Rust V2 baseline.
  --metrics-before FILE   Optional Prometheus text scraped before the k6 run.
  --metrics-after FILE    Optional Prometheus text scraped after the k6 run.
  --metrics FILE          Alias for --metrics-after for one-snapshot reports.
  --json-out FILE         Optional machine-readable report output.
  --allow-missing-metrics Allow k6-only reporting without Prometheus route/query/pool guardrails.
  --help                  Show this help.

The report ignores k6 setup_data so fixture IDs and credentials are never printed.`);
}
