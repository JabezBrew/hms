import { handleV2ApiError } from '@/lib/api/v2/errors'
import { v2Request } from '@/lib/api/v2/client'

const DEFAULT_WINDOW = '15m'
const SUPPORTED_WINDOWS = new Set(['5m', '15m', '1h', '6h', '24h'])
const EMPTY_ARRAY = Object.freeze([])

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

function statusForStatusBucket(statusBucket, p99Ms, budgetMs = 200) {
  if (statusBucket === '5xx') {
    return 'fail'
  }
  if (statusBucket === '4xx' || statusBucket === 'timeout' || statusBucket === 'network') {
    return 'warn'
  }
  return statusForThreshold(p99Ms, budgetMs, budgetMs * 1.75)
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
      return {
        route: route.route_pattern,
        p50_ms: route.p50_ms,
        p95_ms: route.p95_ms,
        p99_ms: route.p99_ms,
        requests: route.count,
        error_rate: ['4xx', '5xx'].includes(route.status_bucket) ? 1 : 0,
        payload_p95_kb: bytesToKb(payload.p95_bytes),
        payload_p99_kb: bytesToKb(payload.p99_bytes),
        status: statusForStatusBucket(route.status_bucket, route.p99_ms),
      }
    })
}

function summarizePayloads(payloads) {
  const rows = asArray(payloads)
  const p95Kb = maxNumber(rows.map((row) => bytesToKb(row.p95_bytes)))
  const p99Kb = maxNumber(rows.map((row) => bytesToKb(row.p99_bytes)))
  return {
    p95_kb: p95Kb,
    p99_kb: p99Kb,
    status: statusForThreshold(p99Kb, 128, 256),
  }
}

function normalizePool(database = {}) {
  const primary = asArray(database.pools).find((pool) => pool.name === 'primary')
    || asArray(database.pools)[0]
    || {}
  const waitP95Ms = maxNumber(asArray(database.pool_waits).map((row) => row.p95_ms))
  return {
    used: primary.in_use,
    max: primary.max_connections,
    pressure: primary.pressure,
    pressure_state: primary.pressure_state,
    wait_p95_ms: waitP95Ms,
    waiters: 0,
    status: statusForPressure(primary.pressure),
  }
}

function normalizeRequestContextCache(cache = {}) {
  return {
    hit_ratio: cache.hit_rate,
    hits: cache.hits_total,
    misses: cache.misses_total,
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
  return {
    app_shell_p95_ms: firstMetricValue(rum.app_shell, 'p95_ms'),
    browser_api_p95_ms: firstMetricValue(rum.api, 'p95_ms'),
    browser_api_p99_ms: firstMetricValue(rum.api, 'p99_ms'),
    sample_count: sumCounts(rum.all),
    status: frontend.rum_enabled ? 'pass' : 'unknown',
  }
}

function normalizeDeployment(snapshot = {}) {
  const runtime = snapshot.runtime || {}
  const api = snapshot.api || {}
  return {
    environment: snapshot.source?.environment,
    version: runtime.version,
    deployed_at: runtime.started_at,
    status: api.ready ? 'pass' : 'fail',
    services: [
      {
        name: runtime.service || 'hms-api',
        status: api.ready ? 'healthy' : 'unhealthy',
        version: runtime.version,
      },
      ...asArray(api.dependencies).map((dependency) => ({
        name: dependency.name,
        status: dependency.ready ? 'healthy' : 'unhealthy',
      })),
    ],
  }
}

function normalizeBudgets({ routes, pool, payloads, rum }) {
  const apiP99 = maxNumber(routes.map((route) => route.p99_ms))
  const payloadP99 = payloads.p99_kb
  return [
    {
      key: 'api-p99',
      label: 'API p99',
      value_ms: apiP99,
      target: '<= 200 ms',
      status: statusForThreshold(apiP99, 200, 350),
    },
    {
      key: 'db-pool',
      label: 'DB pool pressure',
      value_percent: pool.pressure,
      target: '< 70%',
      status: pool.status,
    },
    {
      key: 'payload-p99',
      label: 'Payload p99',
      value: payloadP99 === null ? undefined : `${Math.round(payloadP99)} KB`,
      target: '<= 128 KB',
      status: payloads.status,
    },
    {
      key: 'rum-shell',
      label: 'App shell p95',
      value_ms: rum.app_shell_p95_ms,
      target: '<= 1200 ms',
      status: statusForThreshold(rum.app_shell_p95_ms, 1200, 1800),
    },
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

function normalizeSlowQueries(rows) {
  return asArray(rows).slice(0, 20).map((row, index) => ({
    fingerprint: sanitizeQueryFingerprint(row.fingerprint || row.query_fingerprint, index),
    count: row.count,
    total_ms: row.total_ms,
    avg_ms: row.avg_ms,
    p95_ms: row.p95_ms,
    p99_ms: row.p99_ms,
    status: statusForThreshold(row.p99_ms || row.p95_ms || row.avg_ms, 250, 500),
  }))
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
  return {
    source: poolSnapshot.source || slowQuerySnapshot.source || database.source,
    pool: normalizePool(poolSnapshot),
    pool_waits: normalizeRoutes({ pool_waits: poolSnapshot.pool_waits }, []),
    slow_query_fingerprints: normalizeSlowQueries(slowQuerySnapshot.fingerprints || slowQuerySnapshot.slow_query_fingerprints),
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
    payload: snapshot.payload,
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

  return {
    generated_at: snapshot.source?.generated_at,
    window: snapshot.source?.window,
    source: snapshot.source,
    budgets: normalizeBudgets({ routes, pool, payloads, rum }),
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
    deploys: normalizeDeployment(snapshot),
  }
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

export async function getOpsOverview(params = {}, options = {}) {
  const snapshot = await requestOpsSnapshot(
    '/api/v2/ops/overview',
    params,
    options,
    'Failed to load ops overview',
  )
  return normalizeOpsOverview(snapshot)
}

export async function getOpsPerformance(params = {}, options = {}) {
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

export async function getOpsDatabase(params = {}, options = {}) {
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

export async function getOpsFrontend(params = {}, options = {}) {
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
