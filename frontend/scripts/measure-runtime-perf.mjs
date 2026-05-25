import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = (process.env.HMS_FRONTEND_BASE_URL || 'http://127.0.0.1:4174').replace(/\/$/, '')
const EMAIL = process.env.HMS_FRONTEND_PERF_EMAIL || 'owner@hms.local'
const PASSWORD = process.env.HMS_FRONTEND_PERF_PASSWORD || 'ChangeMe123!'
const FACILITY_CODE = process.env.HMS_FRONTEND_PERF_FACILITY || 'HMS'
const PATIENT_ID = process.env.HMS_FRONTEND_PERF_PATIENT_ID || '31000000-0000-0000-0000-000000000001'
const CPU_THROTTLE_RATE = Number(process.env.HMS_FRONTEND_PERF_CPU_THROTTLE || 4)
const OUTPUT_PATH = process.env.HMS_FRONTEND_PERF_OUT || '/private/tmp/hms-frontend-runtime-perf.json'

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const ROUTES = [
  {
    label: 'patient_registry',
    path: '/patients',
    waitText: /Patient Registry/i,
    apiPattern: /\/api\/v2\/patients(?:\?|$)/,
  },
  {
    label: 'patient_chronicle',
    path: `/patients/${PATIENT_ID}`,
    waitText: /Clinical Chronicle/i,
    apiPattern: /\/api\/v2\/patients\/[^/]+\/chronicle(?:\?|$)/,
  },
  {
    label: 'ward_board',
    path: '/ward-board',
    waitText: /Ward Board/i,
    apiPattern: /\/api\/v2\/wards\/board(?:\?|$)/,
  },
  {
    label: 'lab_orders',
    path: '/laboratory/orders',
    waitText: /Lab Orders/i,
    apiPattern: /\/api\/v2\/lab/,
  },
  {
    label: 'inventory_items',
    path: '/inventory/items',
    waitText: /Inventory Items/i,
    apiPattern: /\/api\/v2\/inventory/,
  },
]

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

function sanitizeResourceName(name) {
  try {
    const url = new URL(name)
    const keys = [...url.searchParams.keys()].sort()
    const search = keys.length > 0 ? `?keys=${keys.join(',')}` : ''
    return `${url.pathname.replace(UUID_PATTERN, ':id')}${search}`
  } catch {
    return String(name || '').replace(UUID_PATTERN, ':id')
  }
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

async function collectMeasurement(page, startedAt) {
  return page.evaluate((start) => {
    const resources = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    }))
    const longTasks = Array.isArray(window.__hmsPerfLongTasks) ? window.__hmsPerfLongTasks : []
    return {
      duration_ms: performance.now() - start,
      resources,
      longTasks,
      longTaskUnsupported: Boolean(window.__hmsPerfLongTasksUnsupported),
    }
  }, startedAt)
}

async function waitForSettled(page) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(150)
}

async function navigateSpa(page, targetPath) {
  const url = new URL(targetPath, BASE_URL).toString()
  try {
    await page.evaluate((nextPath) => {
      window.history.pushState({}, '', nextPath)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, targetPath)
    await page.waitForURL(url, { timeout: 1500 })
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
  }
}

async function measureRoute(page, route) {
  await resetMeasurementWindow(page)
  const startedAt = await page.evaluate(() => performance.now())
  const apiWait = page.waitForResponse((response) => route.apiPattern.test(new URL(response.url()).pathname), {
    timeout: 10000,
  }).catch(() => null)

  await navigateSpa(page, route.path)
  await page.getByText(route.waitText).first().waitFor({ state: 'visible', timeout: 15000 })
  await apiWait
  await waitForSettled(page)

  const raw = await collectMeasurement(page, startedAt)
  const longTaskDurations = raw.longTasks.map((entry) => entry.duration)
  const rowCount = await page.locator('tbody tr').count().catch(() => 0)

  return {
    label: route.label,
    path: route.path.replace(UUID_PATTERN, ':id'),
    duration_ms: round(raw.duration_ms),
    row_count: rowCount,
    long_task_count: longTaskDurations.length,
    long_task_total_ms: round(longTaskDurations.reduce((sum, value) => sum + value, 0)),
    long_task_max_ms: round(Math.max(0, ...longTaskDurations)),
    long_task_observer: raw.longTaskUnsupported ? 'unsupported' : 'supported',
    ...summarizeResources(raw.resources),
  }
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
  await installLongTaskObserver(page)

  await resetMeasurementWindow(page).catch(() => {})
  const loginStartedAt = await page.evaluate(() => performance.now()).catch(() => 0)
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/email address/i).fill(EMAIL)
  await page.getByLabel(/facility code/i).fill(FACILITY_CODE)
  await page.getByLabel(/^password$/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15000 })
  await waitForSettled(page)
  const loginRaw = await collectMeasurement(page, loginStartedAt)

  const results = []
  for (const route of ROUTES) {
    results.push(await measureRoute(page, route))
  }

  await browser.close()

  const loginLongTasks = loginRaw.longTasks.map((entry) => entry.duration)
  const report = {
    captured_at: new Date().toISOString(),
    base_url: BASE_URL,
    cpu_throttle_rate: CPU_THROTTLE_RATE,
    viewport: '1366x768',
    credentials: {
      email_domain: EMAIL.split('@')[1] || null,
      facility_code: FACILITY_CODE,
    },
    login: {
      duration_ms: round(loginRaw.duration_ms),
      long_task_count: loginLongTasks.length,
      long_task_total_ms: round(loginLongTasks.reduce((sum, value) => sum + value, 0)),
      long_task_max_ms: round(Math.max(0, ...loginLongTasks)),
      ...summarizeResources(loginRaw.resources),
    },
    routes: results,
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(`[frontend-perf] ${error.message}`)
  process.exit(1)
})
