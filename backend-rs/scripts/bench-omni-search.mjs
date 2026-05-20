#!/usr/bin/env node

import { performance } from 'node:perf_hooks'

const apiBaseUrl = trimTrailingSlash(process.env.HMS_BENCH_API_BASE_URL || 'http://127.0.0.1:8090/api/v2')
const facilityCode = process.env.HMS_BENCH_FACILITY_CODE || 'HMS'
const email = process.env.HMS_BENCH_EMAIL || 'owner@hms.local'
const password = process.env.HMS_BENCH_PASSWORD || 'ChangeMe123!'
const warmup = positiveInt(process.env.HMS_BENCH_WARMUP, 20)
const iterations = positiveInt(process.env.HMS_BENCH_ITERATIONS, 200)
const p99BudgetMs = positiveInt(process.env.HMS_BENCH_P99_BUDGET_MS, 200)

const cases = [
  { label: 'patients', body: { q: 'Ama', types: ['patients'], limit: 8 } },
  { label: 'inventory', body: { q: 'Paracetamol', types: ['inventory'], limit: 8 } },
  { label: 'all', body: { q: 'General', limit: 8 } },
]

const session = await login()
let failed = false

for (const benchCase of cases) {
  for (let index = 0; index < warmup; index += 1) {
    await search(session, benchCase.body)
  }

  const samples = []
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now()
    await search(session, benchCase.body)
    samples.push(performance.now() - started)
  }

  const stats = summarize(samples)
  const overBudget = stats.p99 > p99BudgetMs
  failed = failed || overBudget
  const marker = overBudget ? 'FAIL' : 'OK'
  console.log(
    `${marker} ${benchCase.label}: n=${iterations} p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms p99=${stats.p99.toFixed(1)}ms max=${stats.max.toFixed(1)}ms budget_p99=${p99BudgetMs}ms`
  )
}

if (failed) {
  process.exitCode = 1
}

async function login() {
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Facility-Code': facilityCode,
    },
    body: JSON.stringify({
      email,
      password,
      facility_code: facilityCode,
    }),
  })
  const cookie = response.headers.getSetCookie?.().join('; ') || response.headers.get('set-cookie') || ''
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`login failed: HTTP ${response.status}`)
  }
  const token = payload?.data?.access_token
  if (!token) {
    throw new Error('login failed: access token missing')
  }
  return { token, cookie }
}

async function search(session, body) {
  const response = await fetch(`${apiBaseUrl}/search/omni`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      'X-Facility-Code': facilityCode,
      Cookie: session.cookie,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`search failed: HTTP ${response.status}`)
  }
  await response.arrayBuffer()
}

function summarize(samples) {
  const sorted = samples.slice().sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] || 0,
  }
}

function percentile(sorted, percentileValue) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)
  return sorted[index]
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}
