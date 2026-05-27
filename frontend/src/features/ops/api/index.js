import { handleV2ApiError } from '@/lib/api/v2/errors'
import { v2Request } from '@/lib/api/v2/client'

const DEFAULT_WINDOW = '15m'
const SUPPORTED_WINDOWS = new Set(['5m', '15m', '1h', '6h', '24h'])
const EMPTY_ARRAY = Object.freeze([])
const MIN_CONFIDENT_SAMPLE_COUNT = 5

function normalizeOpsQuery(params = {}) {
  const requestedWindow = String(params.window || DEFAULT_WINDOW).trim()
  return {
    window: SUPPORTED_WINDOWS.has(requestedWindow) ? requestedWindow : DEFAULT_WINDOW,
  }
}

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error
  }
}

function unwrapData(response) {
  return response?.data || response || {}
}

function asArray(value) {
  return Array.isArray(value) ? value : EMPTY_ARRAY
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toCount(value) {
  const numeric = toNumber(value)
  if (numeric === null || numeric < 0) {
    return 0
  }
  return Math.round(numeric)
}

function confidenceForSamples(samples) {
  const count = toCount(samples)
  if (count <= 0) {
    return 'no_samples'
  }
  if (count < MIN_CONFIDENT_SAMPLE_COUNT) {
    return 'low'
  }
  return 'high'
}

function maxNumber(values) {
  return values.reduce((max, value) => {
    const numeric = toNumber(value)
    return numeric === null ? max : Math.max(max ?? numeric, numeric)
  }, null)
}

function bytesToKb(value) {
  const numeric = toNumber(value)
  return numeric === null ? null : numeric / 1024
}

function statusForThreshold(value, passAtOrBelow, warnAtOrBelow) {
  const numeric = toNumber(value)
  if (numeric === null) {
    return 'unknown'
  }
  if (numeric <= passAtOrBelow) {
    return 'pass'
  }
  if (numeric <= warnAtOrBelow) {
    return 'warn'
  }
  return 'fail'
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  if (['pass', 'passed', 'ok', 'healthy', 'success', 'green', 'normal', 'nominal', 'ready', 'running', 'configured', 'within_budget'].includes(status)) {
    return 'pass'
  }
  if (['warn', 'warning', 'degraded', 'incomplete', 'yellow', 'elevated', 'not_ready'].includes(status)) {
    return 'warn'
  }
  if (['fail', 'failed', 'critical', 'error', 'unhealthy', 'down', 'red', 'saturated', 'over_budget'].includes(status)) {
    return 'fail'
  }
  return 'unknown'
}

function statusForSampledThreshold(value, samples, passAtOrBelow, warnAtOrBelow) {
  const numeric = toNumber(value)
  const count = toCount(samples)
  if (numeric === null || count <= 0) {
    return 'unknown'
  }
  if (count < MIN_CONFIDENT_SAMPLE_COUNT) {
    return 'unknown'
  }
  return statusForThreshold(numeric, passAtOrBelow, warnAtOrBelow)
}

function statusForPressure(value) {
  const numeric = toNumber(value)
  if (numeric === null) {
    return 'unknown'
  }
  if (numeric >= 0.85) {
    return 'fail'
  }
  if (numeric >= 0.7) {
    return 'warn'
  }
  return 'pass'
}

function statusForStatusBucket(statusBucket, p99Ms, samples, budgetMs = 200) {
  if (statusBucket === '5xx') {
    return toCount(samples) < MIN_CONFIDENT_SAMPLE_COUNT ? 'warn' : 'fail'
  }
  if (statusBucket === '4xx' || statusBucket === 'timeout' || statusBucket === 'network') {
    return 'warn'
  }
  return statusForSampledThreshold(p99Ms, samples, budgetMs, budgetMs * 1.75)
}

function routeKey(route) {
  return [
    route?.route_pattern || '',
    route?.status_bucket || '',
    route?.facility_safe || '',
  ].join('|')
}

function payloadLookup(payloads) {
  return new Map(asArray(payloads).map((payload) => [routeKey(payload), payload]))
}

function flattenRouteGroups(routeGroups = {}) {
  return Object.values(routeGroups)
    .filter(Array.isArray)
    .flat()
}

function normalizeRoutes(routeGroups, payloads) {
  const payloadsByRoute = payloadLookup(payloads)
  return flattenRouteGroups(routeGroups)
    .slice(0, 24)
    .map((route) => {
      const payload = payloadsByRoute.get(routeKey(route)) || {}
      const requests = toCount(route.count ?? route.request_count ?? route.requests)
      const payloadSamples = toCount(payload.count)
      return {
        route: route.route_pattern,
        p50_ms: route.p50_ms,
        p95_ms: route.p95_ms,
        p99_ms: route.p99_ms,
        requests,
        sample_count: requests,
        confidence: confidenceForSamples(requests),
        threshold_ms: 200,
        error_rate: toNumber(route.error_rate) ?? (['4xx', '5xx'].includes(route.status_bucket) ? 1 : 0),
        payload_p95_kb: bytesToKb(payload.p95_bytes),
        payload_p99_kb: bytesToKb(payload.p99_bytes),
        payload_sample_count: payloadSamples,
        payload_confidence: confidenceForSamples(payloadSamples),
        delta_label: 'Previous-window baseline pending',
        status_bucket: route.status_bucket,
        facility_safe: route.facility_safe,
        status: statusForStatusBucket(route.status_bucket, route.p99_ms, requests),
        next_action: routeNextAction(route, payload),
      }
    })
}

function summarizePayloads(payloads) {
  const rows = asArray(payloads)
  const p95Kb = maxNumber(rows.map((row) => bytesToKb(row.p95_bytes)))
  const p99Kb = maxNumber(rows.map((row) => bytesToKb(row.p99_bytes)))
  const sampleCount = rows.reduce((total, row) => total + toCount(row.count), 0)
  return {
    p95_kb: p95Kb,
    p99_kb: p99Kb,
    sample_count: sampleCount,
    confidence: confidenceForSamples(sampleCount),
    threshold: '<= 128 KB',
    status: statusForSampledThreshold(p99Kb, sampleCount, 128, 256),
  }
}

function routeNextAction(route, payload = {}) {
  const statusBucket = String(route?.status_bucket || '').toLowerCase()
  const p99Ms = toNumber(route?.p99_ms)
  const payloadP99Kb = bytesToKb(payload?.p99_bytes)
  if (statusBucket === '5xx') {
    return 'Open service errors for this route family'
  }
  if (p99Ms !== null && p99Ms > 350) {
    return 'Inspect related DB fingerprints and payload size'
  }
  if (payloadP99Kb !== null && payloadP99Kb > 128) {
    return 'Trim list DTO fields or gate large expansions'
  }
  return 'Compare against the previous window before changing code'
}

function normalizePool(database = {}) {
  const primary = asArray(database.pools).find((pool) => pool.name === 'primary')
    || asArray(database.pools)[0]
    || {}
  const waitP95Ms = maxNumber(asArray(database.pool_waits).map((row) => row.p95_ms))
  const pressure = toNumber(primary.pressure)
  return {
    used: primary.in_use,
    max: primary.max_connections,
    pressure,
    pressure_state: primary.pressure_state,
    wait_p95_ms: waitP95Ms,
    waiters: 0,
    sample_count: primary.max_connections ? 1 : 0,
    confidence: primary.max_connections ? 'high' : 'no_samples',
    status: statusForPressure(pressure),
  }
}

function normalizeRequestContextCache(cache = {}) {
  const hits = toCount(cache.hits_total)
  const misses = toCount(cache.misses_total)
  const samples = hits + misses
  const hitRate = toNumber(cache.hit_rate)
  return {
    hit_ratio: hitRate,
    hits,
    misses,
    sample_count: samples,
    confidence: confidenceForSamples(samples),
    status: samples < MIN_CONFIDENT_SAMPLE_COUNT || hitRate === null
      ? 'unknown'
      : hitRate >= 0.95 ? 'pass' : hitRate >= 0.85 ? 'warn' : 'fail',
  }
}

function firstMetricValue(rows, field) {
  return asArray(rows).find((row) => row?.[field] !== undefined)?.[field]
}

function sumCounts(rows) {
  return asArray(rows).reduce((total, row) => total + (toNumber(row.count) || 0), 0)
}

function normalizeRum(frontend = {}) {
  const rum = frontend.rum || {}
  const sampleCount = sumCounts(rum.all)
  const apiP99 = firstMetricValue(rum.api, 'p99_ms')
  const appShellP95 = firstMetricValue(rum.app_shell, 'p95_ms')
  const apiP99Ms = toNumber(apiP99)
  return {
    app_shell_p95_ms: appShellP95,
    browser_api_p95_ms: firstMetricValue(rum.api, 'p95_ms'),
    browser_api_p99_ms: apiP99,
    sample_count: sampleCount,
    confidence: confidenceForSamples(sampleCount),
    status: frontend.rum_enabled
      ? statusForSampledThreshold(apiP99Ms === null ? appShellP95 : apiP99Ms, sampleCount, apiP99Ms === null ? 1200 : 600, apiP99Ms === null ? 1800 : 900)
      : 'unknown',
  }
}

function normalizeDeployment(snapshot = {}) {
  const deploySnapshot = snapshot.deploys_snapshot || {}
  const currentDeploy = asArray(deploySnapshot.deploys)[0] || {}
  const edgeChecks = asArray(snapshot.edge_status?.checks)
  const runtime = snapshot.runtime || {}
  const api = snapshot.api || {}
  const current = Object.keys(currentDeploy).length ? currentDeploy : runtime
  const commit = current.build_sha || runtime.build_sha || current.commit || current.git_sha
  const status = api.ready === false ? 'fail' : normalizeStatus(current.status || (api.ready ? 'pass' : undefined))
  return {
    environment: current.environment || snapshot.source?.environment,
    version: current.version || runtime.version,
    commit,
    image_tag: current.image_tag || runtime.image_tag,
    deployed_at: current.deployed_at || runtime.deployed_at || current.started_at || runtime.started_at,
    started_at: current.started_at || runtime.started_at,
    status,
    services: [
      {
        name: current.service || runtime.service || 'hms-api',
        status,
        version: current.version || runtime.version,
        commit,
        image_tag: current.image_tag || runtime.image_tag,
        started_at: current.started_at || runtime.started_at,
        deployed_at: current.deployed_at || runtime.deployed_at,
      },
      ...asArray(api.dependencies).map((dependency) => ({
        name: dependency.name,
        status: dependency.ready ? 'healthy' : 'unhealthy',
      })),
      ...edgeChecks.map((check) => ({
        name: check.component,
        status: check.status,
        checked_at: check.checked_at,
      })),
    ],
  }
}

function normalizeClinicalBudget(budget, index) {
  const sampleCount = toCount(budget.count)
  const budgetMs = toNumber(budget.budget_ms)
  const observedP99 = toNumber(budget.observed_p99_ms)
  return {
    key: budget.key || `clinical-budget-${index + 1}`,
    label: budget.label || `Clinical budget ${index + 1}`,
    value_ms: observedP99,
    sample_count: sampleCount,
    confidence: confidenceForSamples(sampleCount),
    target: budgetMs === null ? 'Budget unavailable' : `<= ${Math.round(budgetMs)} ms`,
    status: statusForSampledThreshold(observedP99, sampleCount, budgetMs ?? 200, (budgetMs ?? 200) * 1.75),
    next_action: observedP99 !== null && budgetMs !== null && observedP99 > budgetMs
      ? 'Review route families in this clinical workflow'
      : 'Keep watching until the sample count is sufficient',
    delta_label: 'Previous-window baseline pending',
  }
}

function normalizeBudgets({ routes, pool, payloads, rum, clinicalBudgets = [] }) {
  const apiP99 = maxNumber(routes.map((route) => route.p99_ms))
  const apiSamples = routes.reduce((total, route) => total + toCount(route.sample_count ?? route.requests), 0)
  const payloadP99 = payloads.p99_kb
  const derivedBudgets = [
    {
      key: 'api-p99',
      label: 'API p99',
      value_ms: apiP99,
      sample_count: apiSamples,
      confidence: confidenceForSamples(apiSamples),
      target: '<= 200 ms',
      status: statusForSampledThreshold(apiP99, apiSamples, 200, 350),
      next_action: 'Review slow routes',
      delta_label: 'Previous-window baseline pending',
    },
    {
      key: 'db-pool',
      label: 'DB pool pressure',
      value_percent: pool.pressure,
      sample_count: pool.sample_count,
      confidence: pool.confidence,
      target: '< 70%',
      status: pool.status,
      next_action: 'Check pool waits and slow DB fingerprints',
      delta_label: 'Previous-window baseline pending',
    },
    {
      key: 'payload-p99',
      label: 'Payload p99',
      value: payloadP99 === null ? undefined : `${Math.round(payloadP99)} KB`,
      sample_count: payloads.sample_count,
      confidence: payloads.confidence,
      target: '<= 128 KB',
      status: payloads.status,
      next_action: 'Trim DTO fields or defer large expansions',
      delta_label: 'Previous-window baseline pending',
    },
    {
      key: 'rum-shell',
      label: 'App shell p95',
      value_ms: rum.app_shell_p95_ms,
      sample_count: rum.sample_count,
      confidence: rum.confidence,
      target: '<= 1200 ms',
      status: statusForSampledThreshold(rum.app_shell_p95_ms, rum.sample_count, 1200, 1800),
      next_action: 'Break down app shell, API, and navigation timings',
      delta_label: 'Previous-window baseline pending',
    },
  ]

  return [
    ...asArray(clinicalBudgets).map(normalizeClinicalBudget),
    ...derivedBudgets,
  ]
}

function normalizePerformance(snapshot = {}) {
  const performance = snapshot.performance || snapshot
  const routeLatency = performance.route_latency || performance.routeLatency || performance
  const requestContext = performance.request_context_cache || performance.requestContextCache || {}
  const payloadSnapshot = performance.payload || performance.payload_snapshot || performance
  const payloadRoutes = payloadSnapshot.routes || performance.payloads || []
  const routeGroups = routeLatency.groups || performance.routes || {}
  const payloadsSummary = summarizePayloads(payloadRoutes)
  return {
    source: routeLatency.source || performance.source,
    routes: normalizeRoutes(routeGroups, payloadRoutes),
    request_context_cache: normalizeRequestContextCache(requestContext.cache || requestContext),
    payloads: payloadsSummary,
  }
}

function sanitizeQueryFingerprint(value, index) {
  const text = String(value || '').trim()
  if (
    !text
    || text.length > 96
    || /(\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bfrom\b|\bwhere\b|\bjoin\b|promql|rate\(|mrn|patient|email|@)/i.test(text)
  ) {
    return `_redacted_query_fingerprint_${index + 1}`
  }
  return /^[a-z0-9._:-]+$/i.test(text) ? text : `_redacted_query_fingerprint_${index + 1}`
}

function normalizeQuantile(value, avgMs) {
  const numeric = toNumber(value)
  const avg = toNumber(avgMs)
  if (numeric === null) {
    return null
  }
  if (numeric === 0 && avg !== null && avg > 0) {
    return null
  }
  return numeric
}

function normalizeSlowQueries(rows) {
  return asArray(rows).slice(0, 20).map((row, index) => {
    const count = toCount(row.count)
    const avgMs = toNumber(row.avg_ms)
    const p95Ms = normalizeQuantile(row.p95_ms, avgMs)
    const p99Ms = normalizeQuantile(row.p99_ms, avgMs)
    return {
      fingerprint: sanitizeQueryFingerprint(row.fingerprint || row.query_fingerprint, index),
      count,
      sample_count: count,
      confidence: confidenceForSamples(count),
      total_ms: row.total_ms,
      avg_ms: avgMs,
      p95_ms: p95Ms,
      p99_ms: p99Ms,
      source: row.source || 'in_process',
      fix_category: queryFixCategory({ avg_ms: avgMs, p95_ms: p95Ms, p99_ms: p99Ms, count }),
      status: statusForSampledThreshold(p99Ms ?? p95Ms ?? avgMs, count, 250, 500),
    }
  })
}

function normalizePgStatStatements(pgStat = {}) {
  return asArray(pgStat.statements).slice(0, 20).map((row, index) => {
    const count = toCount(row.calls)
    const avgMs = toNumber(row.mean_exec_ms)
    return {
      fingerprint: sanitizeQueryFingerprint(row.fingerprint_id, index),
      count,
      sample_count: count,
      confidence: confidenceForSamples(count),
      total_ms: row.total_exec_ms,
      avg_ms: avgMs,
      p95_ms: null,
      p99_ms: null,
      rows: row.rows,
      source: 'pg_stat_statements',
      fix_category: queryFixCategory({ avg_ms: avgMs, count, rows: row.rows }),
      status: statusForSampledThreshold(avgMs, count, 250, 500),
    }
  })
}

function queryFixCategory(row = {}) {
  const avgMs = toNumber(row.avg_ms)
  const p99Ms = toNumber(row.p99_ms)
  const rows = toNumber(row.rows)
  if (rows !== null && rows > 5000) {
    return 'projection_or_index'
  }
  if ((p99Ms ?? avgMs ?? 0) > 500) {
    return 'index_or_lock_pressure'
  }
  return 'review_plan'
}

function mergeSlowQuerySources(inProcessRows, pgStatRows) {
  const rows = [...inProcessRows]
  const existing = new Set(rows.map((row) => row.fingerprint))
  pgStatRows.forEach((row) => {
    if (!existing.has(row.fingerprint)) {
      rows.push(row)
    }
  })
  return rows.slice(0, 20)
}

function normalizeRouteCounters(rows) {
  return asArray(rows).slice(0, 20).map((row) => ({
    route: row.route_pattern,
    status_bucket: row.status_bucket,
    facility_safe: row.facility_safe,
    count: row.count,
  }))
}

function normalizeDatabase(snapshot = {}) {
  const database = snapshot.database || snapshot
  const poolSnapshot = database.db_pool || database.pool_snapshot || database
  const slowQuerySnapshot = database.slow_queries || database.slow_query_fingerprints || database
  const inProcessSlowQueries = normalizeSlowQueries(slowQuerySnapshot.fingerprints || slowQuerySnapshot.slow_query_fingerprints)
  const pgStatSlowQueries = normalizePgStatStatements(slowQuerySnapshot.pg_stat_statements)
  return {
    source: poolSnapshot.source || slowQuerySnapshot.source || database.source,
    pool: normalizePool(poolSnapshot),
    pool_waits: normalizeRoutes({ pool_waits: poolSnapshot.pool_waits }, []),
    slow_query_fingerprints: mergeSlowQuerySources(inProcessSlowQueries, pgStatSlowQueries),
    pg_stat_statements: {
      availability: slowQuerySnapshot.pg_stat_statements?.availability,
      statements: pgStatSlowQueries,
    },
    slow_queries_by_route: normalizeRouteCounters(slowQuerySnapshot.slow_queries_by_route),
  }
}

function normalizeFrontend(snapshot = {}) {
  const frontend = snapshot.frontend || snapshot
  return {
    source: frontend.source,
    rum: normalizeRum(frontend),
    rum_enabled: frontend.rum_enabled,
    routes: normalizeRoutes(frontend.rum, []),
  }
}

function normalizeOpsOverview(snapshot = {}) {
  const performance = snapshot.performance || {
    route_latency: snapshot.route_latency,
    request_context_cache: snapshot.request_context_cache,
    payload: snapshot.payload_snapshot || snapshot.payload,
  }
  const database = snapshot.database || snapshot.db_pool || {}
  const frontend = snapshot.frontend || snapshot.rum || {}
  const payloadRoutes = performance.payload?.routes || performance.payloads || []
  const payloads = summarizePayloads(payloadRoutes)
  const routeGroups = performance.route_latency?.groups || performance.routes || {}
  const routes = normalizeRoutes(routeGroups, payloadRoutes)
  const pool = normalizePool(database)
  const requestContextCache = normalizeRequestContextCache(performance.request_context_cache?.cache || performance.request_context_cache)
  const rum = normalizeRum(frontend)
  const clinicalBudgets = snapshot.clinical_budgets?.budgets || snapshot.clinicalBudgets || []
  const serviceErrors = normalizeServiceErrors(snapshot.service_errors?.errors)

  return {
    generated_at: snapshot.source?.generated_at,
    window: snapshot.source?.window,
    source: snapshot.source,
    budgets: normalizeBudgets({ routes, pool, payloads, rum, clinicalBudgets }),
    performance: {
      routes,
      request_context_cache: requestContextCache,
      payloads,
    },
    database: {
      pool,
      pool_waits: database.pool_waits || [],
      slow_query_fingerprints: normalizeSlowQueries(database.fingerprints || database.slow_query_fingerprints),
      slow_queries_by_route: normalizeRouteCounters(database.slow_queries_by_route),
    },
    frontend: {
      rum,
      rum_enabled: frontend.rum_enabled,
      routes: normalizeRoutes(frontend.rum, []),
    },
    service_errors: serviceErrors,
    deploys: normalizeDeployment(snapshot),
  }
}

function normalizeServiceErrors(rows) {
  return asArray(rows).slice(0, 20).map((row, index) => ({
    key: `${safeServiceComponent(row.component)}-${index}`,
    component: safeServiceComponent(row.component),
    error_class: safeServiceComponent(row.error_class || 'service_error'),
    count: toCount(row.count),
    sample_count: toCount(row.count),
    confidence: confidenceForSamples(row.count),
    last_seen_at: row.last_seen_at,
    status: toCount(row.count) > 0 ? 'fail' : 'unknown',
  }))
}

function safeServiceComponent(value) {
  const text = String(value || '').trim()
  return /^[a-z0-9._:/-]{1,96}$/i.test(text) && !/@|mrn|patient_name|request_body|raw_log/i.test(text)
    ? text
    : 'service'
}

async function requestOpsSnapshot(path, params = {}, options = {}, fallbackMessage) {
  try {
    const response = await v2Request({
      method: 'GET',
      path,
      query: normalizeOpsQuery(params),
      signal: options.signal,
    })
    return unwrapData(response)
  } catch (error) {
    rethrowAbortError(error)
    throw new Error(handleV2ApiError(error, fallbackMessage))
  }
}

function requestOpsSnapshots(paths, params = {}, options = {}, fallbackMessage) {
  return Promise.all(paths.map((path) => requestOpsSnapshot(path, params, options, fallbackMessage)))
}

async function getOpsOverview(params = {}, options = {}) {
  const [
    overview,
    payload,
    clinicalBudgets,
    deploys,
    serviceErrors,
    edgeStatus,
  ] = await requestOpsSnapshots(
    [
      '/api/v2/ops/overview',
      '/api/v2/ops/payload',
      '/api/v2/ops/clinical-budgets',
      '/api/v2/ops/deploys',
      '/api/v2/ops/service-errors',
      '/api/v2/ops/edge-status',
    ],
    params,
    options,
    'Failed to load ops overview',
  )
  return normalizeOpsOverview({
    ...overview,
    payload_snapshot: payload,
    clinical_budgets: clinicalBudgets,
    deploys_snapshot: deploys,
    service_errors: serviceErrors,
    edge_status: edgeStatus,
  })
}

async function getOpsPerformance(params = {}, options = {}) {
  const [routeLatency, requestContextCache, payload] = await requestOpsSnapshots(
    [
      '/api/v2/ops/route-latency',
      '/api/v2/ops/request-context-cache',
      '/api/v2/ops/payload',
    ],
    params,
    options,
    'Failed to load ops route performance',
  )
  return normalizePerformance({ route_latency: routeLatency, request_context_cache: requestContextCache, payload })
}

async function getOpsDatabase(params = {}, options = {}) {
  const [dbPool, slowQueries] = await requestOpsSnapshots(
    [
      '/api/v2/ops/db-pool',
      '/api/v2/ops/slow-query-fingerprints',
    ],
    params,
    options,
    'Failed to load ops database snapshot',
  )
  return normalizeDatabase({ db_pool: dbPool, slow_queries: slowQueries })
}

async function getOpsFrontend(params = {}, options = {}) {
  const snapshot = await requestOpsSnapshot(
    '/api/v2/ops/rum',
    params,
    options,
    'Failed to load ops frontend snapshot',
  )
  return normalizeFrontend(snapshot)
}

export const opsApi = Object.freeze({
  getDashboard: getOpsOverview,
  getOverview: getOpsOverview,
  getPerformance: getOpsPerformance,
  getDatabase: getOpsDatabase,
  getFrontend: getOpsFrontend,
})
