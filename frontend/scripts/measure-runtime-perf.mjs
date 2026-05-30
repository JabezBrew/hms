import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = (process.env.HMS_FRONTEND_BASE_URL || 'http://127.0.0.1:4174').replace(/\/$/, '')
const API_BASE_URL = (process.env.HMS_FRONTEND_PERF_API_BASE_URL || BASE_URL).replace(/\/$/, '')
const EMAIL = process.env.HMS_FRONTEND_PERF_EMAIL || 'owner@hms.local'
const PASSWORD = process.env.HMS_FRONTEND_PERF_PASSWORD || 'ChangeMe123!'
const FACILITY_CODE = process.env.HMS_FRONTEND_PERF_FACILITY || 'HMS'
const CONFIGURED_PATIENT_ID = process.env.HMS_FRONTEND_PERF_PATIENT_ID || ''
const CPU_THROTTLE_RATE = Number(process.env.HMS_FRONTEND_PERF_CPU_THROTTLE || 4)
const OUTPUT_PATH = process.env.HMS_FRONTEND_PERF_OUT || '/private/tmp/hms-frontend-runtime-perf.json'
const RUNTIME_CONFIG_MODE = process.env.HMS_FRONTEND_RUNTIME_CONFIG || 'local-rust-v2'
const DASHBOARD_PATH = process.env.HMS_FRONTEND_PERF_DASHBOARD_PATH || '/dashboards/admin'
const READY_TIMEOUT_MS = Number(process.env.HMS_FRONTEND_PERF_READY_TIMEOUT_MS || 15000)
const POST_READY_SETTLE_MS = Number(process.env.HMS_FRONTEND_PERF_POST_READY_SETTLE_MS || 100)

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const APP_SHELL_TARGET = {
  label: 'app_shell',
  path: '/',
  reportPath: '/',
  readySelector: '[data-perf-ready="app-shell"]',
}

function buildRoutes(patientId) {
  const encodedPatientId = encodeURIComponent(patientId)
  return [
    {
      label: 'dashboard',
      path: DASHBOARD_PATH,
      reportPath: DASHBOARD_PATH,
      readySelector: '[data-perf-ready="admin-dashboard"]',
    },
    {
      label: 'patient_registry',
      path: '/patients',
      reportPath: '/patients',
      readySelector: '[data-perf-ready="patient-registry"]',
    },
    {
      label: 'patient_chronicle',
      path: `/patients/${encodedPatientId}`,
      reportPath: '/patients/:id',
      readySelector: '[data-perf-ready="patient-chronicle"]',
    },
    {
      label: 'ward_board',
      path: '/ward-board',
      reportPath: '/ward-board',
      readySelector: '[data-perf-ready="ward-board"]',
    },
    {
      label: 'lab_orders',
      path: '/laboratory/orders',
      reportPath: '/laboratory/orders',
      readySelector: '[data-perf-ready="lab-orders"]',
    },
    {
      label: 'inventory_items',
      path: '/inventory/items',
      reportPath: '/inventory/items',
      readySelector: '[data-perf-ready="inventory-items"]',
    },
  ]
}

function round(value) {
  return Number(Number(value || 0).toFixed(2))
}

function toKb(bytes) {
  return round(Number(bytes || 0) / 1024)
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function sanitizePathname(pathname) {
  return String(pathname || '')
    .replace(/\/api\/v2\/patients\/[^/?]+(?=\/chronicle(?:\/|$)|$)/g, '/api/v2/patients/:id')
    .replace(/\/patients\/[^/?]+(?=\/|$)/g, '/patients/:id')
    .replace(UUID_PATTERN, ':id')
}

function sanitizeResourceName(name) {
  try {
    const url = new URL(name)
    const keys = [...url.searchParams.keys()].sort()
    const search = keys.length > 0 ? `?keys=${keys.join(',')}` : ''
    return `${sanitizePathname(url.pathname)}${search}`
  } catch {
    return sanitizePathname(name)
  }
}

function buildRuntimeConfigScript() {
  const runtimeConfig = {
    apiBaseUrl: process.env.HMS_FRONTEND_RUNTIME_API_BASE_URL || '/api',
    apiMode: process.env.HMS_FRONTEND_RUNTIME_API_MODE || 'rust-v2',
    v2ApiBaseUrl: process.env.HMS_FRONTEND_RUNTIME_V2_API_BASE_URL || '/api/v2',
    wsUrl: process.env.HMS_FRONTEND_RUNTIME_WS_URL || '',
    defaultFacilityCode: FACILITY_CODE,
    multiFacilityMode: process.env.HMS_FRONTEND_RUNTIME_MULTI_FACILITY || 'false',
    rumEnabled: process.env.HMS_FRONTEND_RUNTIME_RUM_ENABLED || 'false',
    opsDashboardHosts: process.env.HMS_FRONTEND_RUNTIME_OPS_HOSTS || '',
  }
  return `window.__HMS_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig)});\n`
}

async function installRuntimeConfigRoute(page) {
  if (RUNTIME_CONFIG_MODE === 'passthrough') {
    return
  }
  await page.route('**/runtime-config.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: buildRuntimeConfigScript(),
  }))
}

function summarizeResources(entries) {
  const api = entries.filter((entry) => ['fetch', 'xmlhttprequest'].includes(entry.initiatorType))
  const scripts = entries.filter((entry) =>
    entry.initiatorType === 'script' ||
    (typeof entry.name === 'string' && /\/assets\/.+\.js(?:\?|$)/.test(entry.name))
  )
  const styles = entries.filter((entry) => entry.initiatorType === 'css' || entry.name?.endsWith?.('.css'))
  const transfers = entries.map((entry) => Number(entry.transferSize || 0))

  return {
    api_count: api.length,
    api_p95_ms: round(percentile(api.map((entry) => entry.duration), 95)),
    api_p99_ms: round(percentile(api.map((entry) => entry.duration), 99)),
    script_count: scripts.length,
    style_count: styles.length,
    transfer_kb: toKb(transfers.reduce((sum, value) => sum + value, 0)),
    chart_chunk_loaded: scripts.some((entry) => /vendor-recharts/.test(entry.name || '')),
    api_routes: [...new Set(api.map((entry) => sanitizeResourceName(entry.name)))].sort(),
    script_assets: [...new Set(scripts.map((entry) => path.basename(sanitizeResourceName(entry.name))))].sort(),
  }
}

async function installLongTaskObserver(page) {
  await page.addInitScript(() => {
    window.__hmsPerfLongTasks = []
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__hmsPerfLongTasks.push({
            duration: entry.duration,
            startTime: entry.startTime,
          })
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      window.__hmsPerfLongTasksUnsupported = true
    }
  })
}

async function resetMeasurementWindow(page) {
  await page.evaluate(() => {
    performance.clearResourceTimings()
    window.__hmsPerfLongTasks = []
  })
}

async function collectMeasurement(page) {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    }))
    const longTasks = Array.isArray(window.__hmsPerfLongTasks) ? window.__hmsPerfLongTasks : []
    return {
      resources,
      longTasks,
      longTaskUnsupported: Boolean(window.__hmsPerfLongTasksUnsupported),
    }
  })
}

async function waitAfterReady(page) {
  if (POST_READY_SETTLE_MS > 0) {
    await page.waitForTimeout(POST_READY_SETTLE_MS)
  }
}

async function waitForReady(page, target) {
  await page
    .locator(target.readySelector)
    .first()
    .waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS })
}

async function waitForRouteChunkWarmup(page) {
  const startedAt = performance.now()
  const completed = await page
    .waitForFunction(() => window.__hmsRouteChunkWarmupDone === true, { timeout: 5000 })
    .then(() => true)
    .catch(() => false)

  return {
    completed,
    wait_ms: round(performance.now() - startedAt),
  }
}

function summarizeMeasurement(raw, startedAt, readyAt, extras = {}) {
  const longTaskDurations = raw.longTasks.map((entry) => entry.duration)
  return {
    duration_ms: round(readyAt - startedAt),
    observed_ms: round(performance.now() - startedAt),
    post_ready_settle_ms: POST_READY_SETTLE_MS,
    long_task_count: longTaskDurations.length,
    long_task_total_ms: round(longTaskDurations.reduce((sum, value) => sum + value, 0)),
    long_task_max_ms: round(Math.max(0, ...longTaskDurations)),
    long_task_observer: raw.longTaskUnsupported ? 'unsupported' : 'supported',
    ...summarizeResources(raw.resources),
    ...extras,
  }
}

async function fillOptional(locator, value) {
  if (await locator.count() === 0) {
    return false
  }
  await locator.first().fill(value)
  return true
}

async function fetchJsonFromApi(pathName, token) {
  const response = await fetch(new URL(pathName, API_BASE_URL), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    return { ok: false, status: response.status, data: null }
  }
  return { ok: true, status: response.status, data: await response.json() }
}

async function createProbeAccessToken() {
  const response = await fetch(new URL('/api/v2/auth/login', API_BASE_URL), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      facility_code: FACILITY_CODE,
    }),
  })
  if (!response.ok) {
    throw new Error('Unable to authenticate the frontend perf probe API session.')
  }
  const payload = await response.json()
  const accessToken = payload?.data?.access_token
  if (!accessToken) {
    throw new Error('Frontend perf probe API session did not return an access token.')
  }
  return accessToken
}

function listPatientIds(payload) {
  const candidates = [
    payload?.data,
    payload?.data?.items,
    payload?.data?.results,
    payload?.items,
    payload?.results,
  ]
  return candidates
    .find(Array.isArray)
    ?.map((item) => item?.id)
    .filter(Boolean) || []
}

async function canOpenChronicle(token, patientId) {
  const encodedId = encodeURIComponent(patientId)
  const result = await fetchJsonFromApi(`/api/v2/patients/${encodedId}/chronicle`, token)
  return result.ok
}

async function discoverChroniclePatientId() {
  const token = await createProbeAccessToken()
  if (CONFIGURED_PATIENT_ID && await canOpenChronicle(token, CONFIGURED_PATIENT_ID)) {
    return CONFIGURED_PATIENT_ID
  }

  const patients = await fetchJsonFromApi('/api/v2/patients?limit=50', token)
  const patientIds = listPatientIds(patients.data)
  for (const patientId of patientIds.slice(0, 20)) {
    if (await canOpenChronicle(token, patientId)) {
      return patientId
    }
  }

  throw new Error('No chronicle-accessible patient was available for the frontend perf probe.')
}

async function loginToApp(page) {
  await resetMeasurementWindow(page).catch(() => {})
  const startedAt = performance.now()
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/email address/i).fill(EMAIL)
  await fillOptional(page.getByLabel(/facility code/i), FACILITY_CODE)
  await page.getByLabel(/^password$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: READY_TIMEOUT_MS })
  await waitForReady(page, APP_SHELL_TARGET)
  const readyAt = performance.now()
  await waitAfterReady(page)
  return summarizeMeasurement(await collectMeasurement(page), startedAt, readyAt, {
    label: 'login_flow',
    path: '/login',
    mode: 'login',
  })
}

async function measureColdLoad(page, target) {
  await resetMeasurementWindow(page)
  const startedAt = performance.now()
  await page.goto(new URL(target.path, BASE_URL).toString(), { waitUntil: 'domcontentloaded' })
  await waitForReady(page, target)
  const readyAt = performance.now()
  await waitAfterReady(page)
  return summarizeMeasurement(await collectMeasurement(page), startedAt, readyAt, {
    label: target.label,
    path: target.reportPath,
    mode: 'cold_route_load',
  })
}

async function navigateWithHistory(page, targetPath) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, targetPath)
  await page.waitForFunction(
    (nextPath) => `${window.location.pathname}${window.location.search}` === nextPath,
    targetPath,
    { timeout: 1500 },
  )
}

async function measureWarmTransition(page, target) {
  const fromPath = sanitizePathname(new URL(page.url()).pathname)
  let navigationMethod = 'history'

  await resetMeasurementWindow(page)
  let startedAt = performance.now()
  await navigateWithHistory(page, target.path)

  try {
    await waitForReady(page, target)
  } catch (error) {
    navigationMethod = 'document-fallback'
    await resetMeasurementWindow(page)
    startedAt = performance.now()
    await page.goto(new URL(target.path, BASE_URL).toString(), { waitUntil: 'domcontentloaded' })
    await waitForReady(page, target)
  }

  const readyAt = performance.now()
  await waitAfterReady(page)
  return summarizeMeasurement(await collectMeasurement(page), startedAt, readyAt, {
    label: target.label,
    from_path: fromPath,
    path: target.reportPath,
    mode: 'warm_spa_transition',
    navigation_method: navigationMethod,
  })
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE })
  await installRuntimeConfigRoute(page)
  await installLongTaskObserver(page)

  try {
    const login = await loginToApp(page)
    const chroniclePatientId = await discoverChroniclePatientId()
    const routes = buildRoutes(chroniclePatientId)
    const dashboardRoute = routes.find((route) => route.label === 'dashboard') || routes[0]
    const warmRoutes = [
      ...routes.filter((route) => route.label !== 'dashboard'),
      dashboardRoute,
    ]

    const appShell = await measureColdLoad(page, APP_SHELL_TARGET)

    const coldRoutes = []
    for (const route of routes) {
      coldRoutes.push(await measureColdLoad(page, route))
    }

    await measureColdLoad(page, dashboardRoute)
    const routeChunkWarmup = await waitForRouteChunkWarmup(page)
    const warmTransitions = []
    for (const route of warmRoutes) {
      warmTransitions.push(await measureWarmTransition(page, route))
    }

    const report = {
      captured_at: new Date().toISOString(),
      base_url: BASE_URL,
      api_base_url: API_BASE_URL === BASE_URL ? 'same-origin' : API_BASE_URL,
      cpu_throttle_rate: CPU_THROTTLE_RATE,
      viewport: '1366x768',
      credentials: {
        email_domain: EMAIL.split('@')[1] || null,
        facility_code: FACILITY_CODE,
      },
      login,
      app_shell: appShell,
      cold_routes: coldRoutes,
      route_chunk_warmup: routeChunkWarmup,
      warm_transitions: warmTransitions,
    }

    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(`[frontend-perf] ${error.message}`)
  process.exit(1)
})
