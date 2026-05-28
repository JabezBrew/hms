const SHORT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

import Activity from 'lucide-react/dist/esm/icons/activity.js'
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert.js'
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check.js'
import Cloud from 'lucide-react/dist/esm/icons/cloud.js'
import Cpu from 'lucide-react/dist/esm/icons/cpu.js'
import Database from 'lucide-react/dist/esm/icons/database.js'
import Gauge from 'lucide-react/dist/esm/icons/gauge.js'
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import HardDrive from 'lucide-react/dist/esm/icons/hard-drive.js'
import Monitor from 'lucide-react/dist/esm/icons/monitor.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import RouteIcon from 'lucide-react/dist/esm/icons/route.js'
import Server from 'lucide-react/dist/esm/icons/server.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import Timer from 'lucide-react/dist/esm/icons/timer.js'
import TriangleAlert from 'lucide-react/dist/esm/icons/triangle-alert.js'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageShell } from '@/shared/components/page/PageShell'
import { PageState } from '@/shared/components/page/PageState'
import { usePageMeta } from '@/shared/hooks/usePageMeta'
import { isOpsDashboardHost } from '@/features/ops/host'
import {
  useOpsDatabase,
  useOpsFrontend,
  useOpsOverview,
  useOpsPerformance,
} from '@/features/ops/hooks'

const WINDOW_OPTIONS = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
]

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'routes', label: 'Routes', icon: RouteIcon },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'frontend', label: 'Frontend', icon: Monitor },
  { id: 'deploys', label: 'Deploys', icon: Cloud },
  { id: 'incidents', label: 'Incidents', icon: TriangleAlert },
]

const EMPTY_DASHBOARD = Object.freeze({})
const EMPTY_ARRAY = Object.freeze([])

const SAFE_ROUTE_SEGMENTS = new Set([
  'api',
  'v2',
  'ops',
  'dashboard',
  'overview',
  'performance',
  'route-latency',
  'clinical-budgets',
  'database',
  'db-pool',
  'request-context-cache',
  'payload',
  'slow-query-fingerprints',
  'service-errors',
  'deploys',
  'edge-status',
  'frontend',
  'health',
  'alive',
  'ready',
  'metrics',
  'system',
  'deployment-capabilities',
  'observability',
  'rum',
  'auth',
  'me',
  'login',
  'logout',
  'refresh',
  'sessions',
  'patients',
  'chronicle',
  'timeline',
  'encounters',
  'appointments',
  'wards',
  'ward',
  'board',
  'admissions',
  'nursing',
  'tasks',
  'laboratory',
  'orders',
  'results',
  'inventory',
  'billing',
  'invoices',
  'payments',
  'claims',
  'pharmacy',
  'dispensing',
  'staff',
  'admin',
  'features',
  'settings',
])

const STATUS_STYLES = {
  pass: {
    badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: 'text-emerald-600',
    bar: 'bg-emerald-500',
  },
  warn: {
    badge: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: 'text-amber-600',
    bar: 'bg-amber-500',
  },
  fail: {
    badge: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    icon: 'text-rose-600',
    bar: 'bg-rose-500',
  },
  unknown: {
    badge: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    icon: 'text-sky-600',
    bar: 'bg-sky-500',
  },
}

const STATUS_PRIORITY = {
  fail: 0,
  warn: 1,
  unknown: 2,
  pass: 3,
}

function valueFrom(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function asArray(value) {
  return Array.isArray(value) ? value : EMPTY_ARRAY
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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

function normalizePercentNumber(value) {
  const numeric = toNumber(value)
  if (numeric === null) {
    return null
  }
  return numeric <= 1 ? numeric * 100 : numeric
}

function statusForPercent(value, warnAt, failAt) {
  const numeric = normalizePercentNumber(value)
  if (numeric === null) {
    return 'unknown'
  }
  if (numeric >= failAt) {
    return 'fail'
  }
  if (numeric >= warnAt) {
    return 'warn'
  }
  return 'pass'
}

function routeStatus(row) {
  const bucket = String(valueFrom(row.status_bucket, row.statusBucket, '')).toLowerCase()
  const samples = toNumber(valueFrom(row.sample_count, row.requests, row.count)) || 0
  if (bucket === '5xx' || bucket === 'timeout' || bucket === 'network') {
    return samples < 5 ? 'warn' : 'fail'
  }
  if (bucket === '4xx') {
    return 'warn'
  }
  if (samples < 5) {
    return 'unknown'
  }
  return normalizeStatus(valueFrom(row.status, statusForThreshold(row.p99_ms, 200, 350)))
}

function formatNumber(value) {
  const numeric = toNumber(value)
  return numeric === null ? 'N/A' : numeric.toLocaleString()
}

function formatMs(value) {
  const numeric = toNumber(value)
  if (numeric === null) {
    return 'Awaiting data'
  }
  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(1)} s`
  }
  return `${Math.round(numeric)} ms`
}

function formatPercent(value) {
  const numeric = normalizePercentNumber(value)
  return numeric === null ? 'Awaiting data' : `${numeric.toFixed(1)}%`
}

function formatConfidence(value) {
  const confidence = String(value || '').trim().toLowerCase()
  if (confidence === 'high') {
    return 'High confidence'
  }
  if (confidence === 'low') {
    return 'Low confidence'
  }
  if (confidence === 'no_samples' || confidence === 'insufficient_data') {
    return 'No samples'
  }
  return 'Unknown confidence'
}

function formatSizeKb(value) {
  const numeric = toNumber(value)
  if (numeric === null) {
    return 'Awaiting data'
  }
  if (numeric >= 1024) {
    return `${(numeric / 1024).toFixed(1)} MB`
  }
  return `${Math.round(numeric)} KB`
}

function formatIso(value) {
  if (!value) {
    return 'N/A'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'N/A'
  }
  return SHORT_DATE_TIME_FORMATTER.format(date)
}

function safeText(value, fallback = 'N/A', maxLength = 64) {
  const text = String(value || '').trim()
  if (
    !text
    || text.length > maxLength
    || /(@|https?:\/\/|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bfrom\b|\bwhere\b|\bjoin\b|promql|rate\(|mrn|patient_name|request_body|raw_log|free-text)/i.test(text)
  ) {
    return fallback
  }
  return /^[a-zA-Z0-9._:+<>= %()-]+$/.test(text) ? text : fallback
}

function shortCommit(value) {
  const commit = safeText(value, '', 48)
  return commit ? commit.slice(0, 12) : 'N/A'
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment).trim()
  } catch {
    return segment.trim()
  }
}

function isDynamicSegment(segment) {
  return (
    /^\d+$/.test(segment)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)
    || /^(pat|mrn|enc|adm|ord|inv|rx|lab)[-_][a-z0-9-]{3,}$/i.test(segment)
    || (segment.length >= 10 && /[0-9]/.test(segment) && /[a-z]/i.test(segment))
    || /^[:{][a-z0-9_ -]*(id|uuid|slug|code)[}]?$/i.test(segment)
  )
}

function shouldTreatAsPatientIdentifier(segment, previousSegment) {
  const previous = String(previousSegment || '').toLowerCase()
  return ['patients', 'patient', 'encounters', 'admissions', 'orders', 'invoices', 'payments', 'claims'].includes(previous)
    && !String(segment || '').startsWith(':')
}

function sanitizeRoutePath(value) {
  const route = String(value || '/').split('?')[0].split('#')[0].trim()
  const methodMatch = route.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i)
  const method = methodMatch ? `${methodMatch[1].toUpperCase()} ` : ''
  const path = methodMatch ? methodMatch[2] : route

  let pathname = '/'
  try {
    pathname = new URL(path, 'http://hms.local').pathname
  } catch {
    pathname = path.startsWith('/') ? path : `/${path}`
  }

  const segments = pathname
    .split('/')
    .filter(Boolean)
    .slice(0, 8)
    .map((segment, index, allSegments) => {
      const decoded = decodeSegment(segment)
      const normalized = decoded.toLowerCase()
      if (!decoded || isDynamicSegment(decoded) || shouldTreatAsPatientIdentifier(decoded, allSegments[index - 1])) {
        return ':id'
      }
      if (SAFE_ROUTE_SEGMENTS.has(normalized)) {
        return normalized
      }
      return ':redacted'
    })

  return `${method}/${segments.join('/')}`.replace(/\/$/, '') || '/'
}

function safeFingerprint(value, index) {
  const text = safeText(value, '', 96)
  return text || `_redacted_query_fingerprint_${index + 1}`
}

function sortRoutes(rows) {
  return asArray(rows).toSorted((a, b) => {
    const statusDelta = STATUS_PRIORITY[routeStatus(a)] - STATUS_PRIORITY[routeStatus(b)]
    if (statusDelta !== 0) {
      return statusDelta
    }
    return (toNumber(b.p99_ms) || 0) - (toNumber(a.p99_ms) || 0)
  })
}

function normalizeBudget(budget, index) {
  const value = valueFrom(budget.display_value, budget.value_label, budget.value)
  const valueMs = valueFrom(budget.value_ms, budget.observed_p99_ms, budget.p99_ms, budget.p95_ms)
  const valuePercent = valueFrom(budget.value_percent, budget.percent, budget.ratio)
  const sampleCount = toNumber(valueFrom(budget.sample_count, budget.count, budget.samples))
  return {
    key: safeText(valueFrom(budget.key, budget.id), `budget-${index}`, 48),
    label: safeText(valueFrom(budget.label, budget.name, `Budget ${index + 1}`), `Budget ${index + 1}`, 48),
    value: value !== undefined
      ? safeText(value, 'Awaiting data', 28)
      : valueMs !== undefined
        ? formatMs(valueMs)
        : valuePercent !== undefined
          ? formatPercent(valuePercent)
          : 'Awaiting data',
    target: safeText(valueFrom(budget.target, budget.budget, budget.threshold, budget.budget_ms ? `<= ${Math.round(budget.budget_ms)} ms` : 'No target'), 'No target', 32),
    status: normalizeStatus(budget.status),
    sample_count: sampleCount,
    confidence: valueFrom(budget.confidence, sampleCount > 0 ? 'high' : 'no_samples'),
    next_action: safeText(budget.next_action, 'Review related drilldown', 80),
    delta_label: safeText(budget.delta_label, 'Previous-window baseline pending', 80),
  }
}

function sourceNotes(source) {
  return asArray(source?.notes).slice(0, 4).map((note, index) => {
    const key = safeText(note.key, `source-${index + 1}`, 48)
    return {
      key,
      status: normalizeStatus(note.status),
      note: key === 'historical_windows'
        ? 'Fixed windows are selected in the UI; backend may still report current process lifetime until historical summaries land.'
        : 'Backend provided a PHI-safe source note.',
    }
  })
}

function buildFallbackBudgets(dashboard) {
  const pool = dashboard.database?.pool || {}
  const rum = dashboard.frontend?.rum || {}
  const routeSamples = asArray(dashboard.performance?.routes).reduce((total, row) => total + (toNumber(valueFrom(row.sample_count, row.requests, row.count)) || 0), 0)
  return [
    {
      key: 'api-p99',
      label: 'API p99',
      value: formatMs(Math.max(...asArray(dashboard.performance?.routes).map((row) => toNumber(row.p99_ms) || 0))),
      target: '<= 200 ms',
      status: routeSamples < 5 ? 'unknown' : statusForThreshold(Math.max(...asArray(dashboard.performance?.routes).map((row) => toNumber(row.p99_ms) || 0)), 200, 350),
      sample_count: routeSamples,
      confidence: routeSamples >= 5 ? 'high' : routeSamples > 0 ? 'low' : 'no_samples',
      next_action: 'Review slow routes',
      delta_label: 'Previous-window baseline pending',
    },
    {
      key: 'db-pool',
      label: 'DB pool pressure',
      value: formatPercent(valueFrom(pool.pressure, pool.pressure_percent)),
      target: '< 70%',
      status: pool.status || statusForPercent(valueFrom(pool.pressure, pool.pressure_percent), 70, 85),
      sample_count: pool.sample_count,
      confidence: pool.confidence,
      next_action: 'Check pool waits and slow DB fingerprints',
      delta_label: 'Previous-window baseline pending',
    },
    {
      key: 'rum-shell',
      label: 'App shell p95',
      value: formatMs(rum.app_shell_p95_ms),
      target: '<= 1200 ms',
      status: (toNumber(rum.sample_count) || 0) < 5 ? 'unknown' : statusForThreshold(rum.app_shell_p95_ms, 1200, 1800),
      sample_count: rum.sample_count,
      confidence: rum.confidence,
      next_action: 'Break down app shell, API, and navigation timings',
      delta_label: 'Previous-window baseline pending',
    },
  ]
}

function collectIncidents({ budgets, routes, database, frontend, deploys, serviceErrors }) {
  const incidents = []
  budgets.forEach((budget) => {
    if (['fail', 'warn'].includes(normalizeStatus(budget.status))) {
      incidents.push({
        key: `budget-${budget.key}`,
        severity: normalizeStatus(budget.status),
        area: 'Budget',
        title: budget.label,
        detail: `${budget.value} against ${budget.target}`,
        threshold: budget.target,
        sample_count: budget.sample_count,
        source: 'ops budget',
        next_action: budget.next_action,
      })
    }
  })

  sortRoutes(routes).slice(0, 8).forEach((row, index) => {
    const status = routeStatus(row)
    if (status === 'fail' || status === 'warn') {
      incidents.push({
        key: `route-${index}`,
        severity: status,
        area: 'Route',
        title: sanitizeRoutePath(valueFrom(row.route, row.path, row.name)),
        detail: `${formatMs(row.p99_ms)} p99 / ${formatNumber(valueFrom(row.requests, row.count))} requests`,
        threshold: '<= 200 ms p99',
        sample_count: valueFrom(row.sample_count, row.requests, row.count),
        source: 'route latency',
        next_action: safeText(row.next_action, 'Inspect route detail', 80),
      })
    }
  })

  const poolStatus = normalizeStatus(database.pool?.status || statusForPercent(database.pool?.pressure, 70, 85))
  if (poolStatus === 'fail' || poolStatus === 'warn') {
    incidents.push({
      key: 'db-pool',
      severity: poolStatus,
      area: 'Database',
      title: 'Pool pressure',
      detail: `${formatPercent(database.pool?.pressure)} pressure / ${formatMs(database.pool?.wait_p95_ms)} acquire p95`,
      threshold: '< 70% pressure',
      sample_count: database.pool?.sample_count,
      source: 'db pool',
      next_action: 'Check pool waits and slow query fingerprints',
    })
  }

  asArray(database.slow_query_fingerprints).slice(0, 4).forEach((query, index) => {
    const severity = normalizeStatus(query.status || statusForThreshold(query.p99_ms || query.p95_ms || query.avg_ms, 250, 500))
    if (!['fail', 'warn'].includes(severity)) {
      return
    }
    incidents.push({
      key: `slow-query-${index}`,
      severity,
      area: 'Database',
      title: safeFingerprint(query.fingerprint, index),
      detail: `${formatMs(valueFrom(query.p99_ms, query.p95_ms, query.avg_ms))} slow fingerprint`,
      threshold: '<= 250 ms',
      sample_count: query.sample_count || query.count,
      source: query.source || 'slow query',
      next_action: query.fix_category === 'projection_or_index'
        ? 'Check projection and index coverage'
        : 'Inspect query plan and lock pressure',
    })
  })

  const apiP99Status = statusForThreshold(frontend.rum?.browser_api_p99_ms, 600, 900)
  if (apiP99Status === 'fail' || apiP99Status === 'warn') {
    incidents.push({
      key: 'frontend-api-p99',
      severity: apiP99Status,
      area: 'Frontend',
      title: 'Browser API p99',
      detail: formatMs(frontend.rum?.browser_api_p99_ms),
      threshold: '<= 600 ms',
      sample_count: frontend.rum?.sample_count,
      source: 'browser RUM',
      next_action: 'Separate auth redirects from app API latency',
    })
  }

  asArray(serviceErrors).forEach((error, index) => {
    incidents.push({
      key: `service-error-${index}`,
      severity: 'fail',
      area: 'Service',
      title: safeText(error.component, 'service error', 48),
      detail: `${formatNumber(error.count)} ${safeText(error.error_class, 'errors', 48)}`,
      threshold: '0 errors',
      sample_count: error.count,
      source: 'service errors',
      next_action: 'Open the related route or service logs',
    })
  })

  asArray(deploys.services).forEach((service, index) => {
    const status = normalizeStatus(valueFrom(service.status, service.health))
    if (status === 'fail' || status === 'warn') {
      incidents.push({
        key: `service-${index}`,
        severity: status,
        area: 'Service',
        title: safeText(service.name, 'service', 40),
        detail: 'Dependency is not reporting healthy.',
        threshold: 'healthy',
        sample_count: 1,
        source: 'readiness',
        next_action: 'Check container health and recent restarts',
      })
    }
  })

  return incidents
}

function dashboardDiagnosis({ incidents, routes, dashboard }) {
  const source = dashboard.source || {}
  const sourceAvailable = source.available !== false
  const degradedRoutes = asArray(routes).filter((route) => ['fail', 'warn'].includes(routeStatus(route)))
  const failed = incidents.filter((incident) => normalizeStatus(incident.severity) === 'fail').length
  const warnings = incidents.filter((incident) => normalizeStatus(incident.severity) === 'warn').length

  if (!sourceAvailable) {
    return {
      status: 'unknown',
      title: 'Historical telemetry is unavailable',
      why: 'The dashboard is falling back to process-local metrics, so missing samples are not treated as healthy.',
      action: 'Verify Prometheus env is present in hms-api and that Prometheus can query hms-api metrics.',
    }
  }
  if (failed || warnings) {
    return {
      status: failed ? 'fail' : 'warn',
      title: failed
        ? `${failed} failed ops signal${failed === 1 ? '' : 's'} need review`
        : `${warnings} warning signal${warnings === 1 ? '' : 's'} need review`,
      why: degradedRoutes.length
        ? `${degradedRoutes.length} route family${degradedRoutes.length === 1 ? '' : 'ies'} exceed or approach the p99 budget.`
        : 'One or more budget, database, frontend, or service health signals is outside target.',
      action: degradedRoutes.length ? 'Open Routes, then inspect related DB fingerprints and payload size.' : 'Open Incidents and follow the next action for the highest severity row.',
    }
  }
  return {
    status: 'pass',
    title: 'No breached ops signals with current samples',
    why: 'Current sampled route, database, payload, RUM, and deploy health signals are within configured thresholds.',
    action: 'Keep monitoring; compare against previous windows before making performance changes.',
  }
}

function StatusPill({ status }) {
  const normalized = normalizeStatus(status)
  const Icon = normalized === 'pass' ? CircleCheck : normalized === 'fail' ? TriangleAlert : CircleAlert
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px]',
        STATUS_STYLES[normalized].badge,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {normalized.toUpperCase()}
    </span>
  )
}

function WindowSelector({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" aria-label="Time window">
      {WINDOW_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors',
            value === option.value && 'bg-background text-foreground shadow-sm',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function TabNav({ activeTab, onChange }) {
  return (
    <div className="overflow-x-auto border-b border-border">
      <div className="flex min-w-max gap-1 px-4 sm:px-6" role="tablist" aria-label="Ops dashboard sections">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const selected = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 py-3 font-mono text-xs text-muted-foreground transition-colors',
                selected ? 'border-foreground text-foreground' : 'border-transparent hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function BudgetCard({ budget }) {
  const normalized = normalizeStatus(budget.status)
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase text-muted-foreground">{budget.label}</p>
          <p className="mt-2 font-display text-2xl text-foreground">{budget.value}</p>
        </div>
        <StatusPill status={normalized} />
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', STATUS_STYLES[normalized].bar)}
          style={{ width: normalized === 'pass' ? '100%' : normalized === 'warn' ? '66%' : normalized === 'fail' ? '34%' : '18%' }}
        />
      </div>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">{budget.target}</p>
      <div className="mt-3 grid gap-1 font-mono text-[11px] text-muted-foreground">
        <span>{formatNumber(budget.sample_count)} samples · {formatConfidence(budget.confidence)}</span>
        <span>{safeText(budget.delta_label, 'Previous-window baseline pending', 80)}</span>
        <span>Next: {safeText(budget.next_action, 'Review related drilldown', 80)}</span>
      </div>
    </article>
  )
}

function MetricBox({ icon: Icon, label, value, detail, status = 'unknown' }) {
  const normalized = normalizeStatus(status)
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-2xl text-foreground">{value}</p>
          {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
        </div>
        <Icon className={cn('size-5 shrink-0', STATUS_STYLES[normalized].icon)} aria-hidden="true" />
      </div>
    </div>
  )
}

function SourceNotes({ source }) {
  const notes = sourceNotes(source)
  if (!notes.length) {
    return null
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {notes.map((note) => (
        <div key={note.key} className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase text-muted-foreground">{note.key}</p>
            <StatusPill status={note.status} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{note.note}</p>
        </div>
      ))}
    </div>
  )
}

function DiagnosisPanel({ diagnosis }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase text-muted-foreground">Current diagnosis</p>
          <h3 className="mt-1 font-heading text-lg text-foreground">{diagnosis.title}</h3>
        </div>
        <StatusPill status={diagnosis.status} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <p className="text-sm text-muted-foreground">{diagnosis.why}</p>
        <p className="text-sm text-muted-foreground">Next: {diagnosis.action}</p>
      </div>
    </div>
  )
}

function SectionHeading({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex items-center gap-2">
        <div className="rounded-md border border-border bg-muted/40 p-2">
          <Icon className="size-4 text-foreground" aria-hidden="true" />
        </div>
        <h2 className="font-heading text-lg text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function EmptyPanel({ children }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function RouteLatencyTable({ rows, compact = false }) {
  const sortedRows = sortRoutes(rows).slice(0, compact ? 8 : 20)
  if (!sortedRows.length) {
    return <EmptyPanel>Route latency data is not available for this window.</EmptyPanel>
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Route</TableHead>
            <TableHead>Bucket</TableHead>
            <TableHead>p50</TableHead>
            <TableHead>p95</TableHead>
            <TableHead>p99</TableHead>
            <TableHead>Requests</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Delta</TableHead>
            <TableHead>Payload p99</TableHead>
            <TableHead>Next action</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row) => {
            const route = sanitizeRoutePath(valueFrom(row.route, row.path, row.name))
            return (
              <TableRow key={`${route}-${safeText(row.status_bucket, 'N/A', 16)}`}>
                <TableCell className="max-w-[320px]">
                  <div className="flex items-center gap-2">
                    <RouteIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-mono text-xs">{route}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{safeText(row.status_bucket, 'N/A', 16)}</TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.p50_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.p95_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.p99_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{formatNumber(valueFrom(row.requests, row.count))}</TableCell>
                <TableCell className="font-mono text-xs">{formatConfidence(row.confidence)}</TableCell>
                <TableCell className="font-mono text-xs">{safeText(row.delta_label, 'Baseline pending', 80)}</TableCell>
                <TableCell className="font-mono text-xs">{formatSizeKb(valueFrom(row.payload_p99_kb, row.payload?.p99_kb))}</TableCell>
                <TableCell className="max-w-[260px] text-xs text-muted-foreground">{safeText(row.next_action, 'Inspect route detail', 80)}</TableCell>
                <TableCell><StatusPill status={routeStatus(row)} /></TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function PressureBar({ value, status }) {
  const percent = Math.max(0, Math.min(100, normalizePercentNumber(value) ?? 0))
  const normalized = normalizeStatus(status || statusForPercent(percent, 70, 85))
  return (
    <div className="space-y-2">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', STATUS_STYLES[normalized].bar)} style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>0%</span>
        <span>{formatPercent(percent)}</span>
        <span>100%</span>
      </div>
    </div>
  )
}

function DatabasePanel({ database, cache }) {
  const pool = database.pool || {}
  const used = valueFrom(pool.used, pool.checked_out, pool.in_use)
  const max = valueFrom(pool.max, pool.size, pool.capacity)
  const pressure = valueFrom(pool.pressure_percent, pool.pressure, max ? (Number(used || 0) / Number(max)) : null)
  const waitP95 = valueFrom(pool.wait_p95_ms, pool.acquire_p95_ms, pool.checkout_p95_ms)
  const cacheHitRatio = valueFrom(cache.hit_ratio, cache.hit_percent, cache.ratio)
  const cachePercent = normalizePercentNumber(cacheHitRatio)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-heading text-base text-foreground">Pool Pressure</h3>
              <p className="text-xs text-muted-foreground">
                Checked-out connections against capacity · {formatConfidence(pool.confidence)}
              </p>
            </div>
            <StatusPill status={pool.status || statusForPercent(pressure, 70, 85)} />
          </div>
          <PressureBar value={pressure} status={pool.status} />
        </div>
        <MetricBox
          icon={ShieldCheck}
          label="Request-context cache"
          value={formatPercent(cacheHitRatio)}
          detail={`${formatNumber(cache.hits)} hits / ${formatNumber(cache.misses)} misses`}
          status={cache.status || (cachePercent === null ? 'unknown' : cachePercent >= 95 ? 'pass' : cachePercent >= 85 ? 'warn' : 'fail')}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricBox icon={Database} label="In use" value={`${formatNumber(used)} / ${formatNumber(max)}`} status={pool.status} />
        <MetricBox icon={Timer} label="Acquire p95" value={formatMs(waitP95)} status={statusForThreshold(waitP95, 25, 75)} />
        <MetricBox icon={Cpu} label="Waiters" value={formatNumber(valueFrom(pool.waiting, pool.waiters, 0))} status={statusForThreshold(valueFrom(pool.waiting, pool.waiters, 0), 0, 3)} />
      </div>
      <SlowQueryTable rows={database.slow_query_fingerprints} />
    </div>
  )
}

function SlowQueryTable({ rows }) {
  const slowRows = asArray(rows)
  if (!slowRows.length) {
    return <EmptyPanel>No slow query fingerprints crossed the reporting threshold.</EmptyPanel>
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fingerprint</TableHead>
            <TableHead>Count</TableHead>
            <TableHead>Avg</TableHead>
            <TableHead>p95</TableHead>
            <TableHead>p99</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Fix category</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slowRows.map((row) => {
            const fingerprint = safeFingerprint(row.fingerprint, `${row.source || 'source'}-${row.status || 'status'}`)
            return (
              <TableRow key={fingerprint}>
                <TableCell className="max-w-[360px] truncate font-mono text-xs">{fingerprint}</TableCell>
                <TableCell className="font-mono text-xs">{formatNumber(row.count)}</TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.avg_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.p95_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.p99_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{safeText(row.source, 'in_process', 32)}</TableCell>
                <TableCell className="font-mono text-xs">{safeText(row.fix_category, 'review_plan', 32)}</TableCell>
                <TableCell><StatusPill status={row.status || statusForThreshold(row.p99_ms || row.p95_ms, 250, 500)} /></TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function RumPanel({ frontend }) {
  const rum = frontend.rum || {}
  const appShellP95 = valueFrom(rum.app_shell_p95_ms, rum.shell_p95_ms)
  const apiP95 = valueFrom(rum.browser_api_p95_ms, rum.api_p95_ms)
  const apiP99 = valueFrom(rum.browser_api_p99_ms, rum.api_p99_ms)
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricBox icon={Monitor} label="App shell p95" value={formatMs(appShellP95)} detail="Static assets and app boot" status={(toNumber(rum.sample_count) || 0) < 5 ? 'unknown' : statusForThreshold(appShellP95, 1200, 1800)} />
        <MetricBox icon={Globe} label="Browser API p95" value={formatMs(apiP95)} detail="Client-observed API calls" status={(toNumber(rum.sample_count) || 0) < 5 ? 'unknown' : statusForThreshold(apiP95, 300, 500)} />
        <MetricBox icon={Timer} label="Browser API p99" value={formatMs(apiP99)} detail="Separate redirects before backend work" status={(toNumber(rum.sample_count) || 0) < 5 ? 'unknown' : statusForThreshold(apiP99, 600, 900)} />
        <MetricBox icon={Activity} label="RUM samples" value={formatNumber(valueFrom(rum.sample_count, rum.samples))} detail={formatConfidence(rum.confidence)} status={rum.status || 'unknown'} />
      </div>
      <RouteLatencyTable rows={frontend.routes} />
    </div>
  )
}

function DeploymentPanel({ deployment }) {
  const services = asArray(valueFrom(deployment.services, deployment.health, []))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricBox icon={Cloud} label="API readiness" value={normalizeStatus(deployment.status).toUpperCase()} status={deployment.status} />
        <MetricBox icon={GitBranch} label="Version" value={safeText(deployment.version, 'N/A', 32)} status={deployment.status} />
        <MetricBox icon={GitBranch} label="Commit" value={shortCommit(valueFrom(deployment.commit, deployment.git_sha))} status={deployment.status} />
        <MetricBox icon={Timer} label="Started" value={formatIso(valueFrom(deployment.started_at, deployment.deployed_at, deployment.updated_at))} status={deployment.status} />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Commit</TableHead>
              <TableHead>Image</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.length ? services.map((service) => (
              <TableRow key={safeText(service.name, 'service', 40)}>
                <TableCell className="font-mono text-xs">{safeText(service.name, 'service', 40)}</TableCell>
                <TableCell><StatusPill status={valueFrom(service.status, service.health)} /></TableCell>
                <TableCell className="font-mono text-xs">{safeText(service.version, 'N/A', 32)}</TableCell>
                <TableCell className="font-mono text-xs">{shortCommit(valueFrom(service.commit, service.git_sha))}</TableCell>
                <TableCell className="font-mono text-xs">{safeText(service.image_tag, 'N/A', 32)}</TableCell>
                <TableCell className="font-mono text-xs">{formatIso(valueFrom(service.started_at, service.checked_at))}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-sm text-muted-foreground">
                  Service health is not available yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function IncidentPanel({ incidents }) {
  const failCount = incidents.filter((incident) => normalizeStatus(incident.severity) === 'fail').length
  const warnCount = incidents.filter((incident) => normalizeStatus(incident.severity) === 'warn').length

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricBox icon={TriangleAlert} label="Failed signals" value={formatNumber(failCount)} status={failCount > 0 ? 'fail' : 'pass'} />
        <MetricBox icon={CircleAlert} label="Warning signals" value={formatNumber(warnCount)} status={warnCount > 0 ? 'warn' : 'pass'} />
        <MetricBox icon={ShieldCheck} label="Aggregate" value={incidents.length ? 'Review' : 'Clear'} status={failCount ? 'fail' : warnCount ? 'warn' : 'pass'} />
      </div>
      {incidents.length ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Threshold</TableHead>
                <TableHead>Samples</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incidents.map((incident) => (
                <TableRow key={incident.key}>
                  <TableCell className="font-mono text-xs">{safeText(incident.area, 'Signal', 24)}</TableCell>
                  <TableCell className="max-w-[320px] truncate font-mono text-xs">{incident.title}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{safeText(incident.detail, 'Review measured signal', 80)}</TableCell>
                  <TableCell className="font-mono text-xs">{safeText(incident.threshold, 'N/A', 32)}</TableCell>
                  <TableCell className="font-mono text-xs">{formatNumber(incident.sample_count)}</TableCell>
                  <TableCell className="font-mono text-xs">{safeText(incident.source, 'ops', 32)}</TableCell>
                  <TableCell className="max-w-[260px] text-xs text-muted-foreground">{safeText(incident.next_action, 'Open related drilldown', 96)}</TableCell>
                  <TableCell><StatusPill status={incident.severity} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyPanel>No failed or warning aggregate signals for this window.</EmptyPanel>
      )}
    </div>
  )
}

function LoadingDashboard({ pageMeta }) {
  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Ops Dashboard"
        description="Rust V2 engineer control plane"
        titleClassName="tracking-normal"
        className="rounded-lg border border-border bg-card"
      />
      <main className="p-4 sm:p-6">
        <PageState variant="loading" fullHeight={false} className="min-h-[420px] rounded-lg border border-border" />
      </main>
    </PageShell>
  )
}

export default function OpsDashboardPage() {
  const [windowValue, setWindowValue] = useState('15m')
  const [activeTab, setActiveTab] = useState('overview')
  const opsHostAllowed = isOpsDashboardHost()
  const pageMeta = usePageMeta({
    title: 'Ops Dashboard | Hospital Management System',
    breadcrumbs: [
      { label: 'System', path: '/system/ops' },
      { label: 'Ops Dashboard', path: '/system/ops' },
    ],
  })
  const queryParams = useMemo(() => ({ window: windowValue }), [windowValue])

  const overviewQuery = useOpsOverview(queryParams, { enabled: opsHostAllowed })
  const performanceQuery = useOpsPerformance(queryParams, { enabled: opsHostAllowed && activeTab === 'routes' })
  const databaseQuery = useOpsDatabase(queryParams, { enabled: opsHostAllowed && activeTab === 'database' })
  const frontendQuery = useOpsFrontend(queryParams, { enabled: opsHostAllowed && activeTab === 'frontend' })

  const dashboard = overviewQuery.data || EMPTY_DASHBOARD
  const performance = performanceQuery.data || dashboard.performance || EMPTY_DASHBOARD
  const database = databaseQuery.data || dashboard.database || EMPTY_DASHBOARD
  const frontend = frontendQuery.data || dashboard.frontend || EMPTY_DASHBOARD
  const deployment = dashboard.deploys || EMPTY_DASHBOARD
  const serviceErrors = dashboard.service_errors || EMPTY_ARRAY
  const budgets = useMemo(() => {
    const normalized = asArray(valueFrom(dashboard.budgets, dashboard.overview?.budgets)).map(normalizeBudget)
    return normalized.length ? normalized : buildFallbackBudgets(dashboard)
  }, [dashboard])
  const routeRows = useMemo(() => sortRoutes(valueFrom(performance.routes, dashboard.performance?.routes, [])), [performance, dashboard])
  const cache = valueFrom(performance.request_context_cache, dashboard.performance?.request_context_cache, {})
  const payloads = valueFrom(performance.payloads, dashboard.performance?.payloads, {})
  const incidents = useMemo(
    () => collectIncidents({ budgets, routes: routeRows, database, frontend, deploys: deployment, serviceErrors }),
    [budgets, routeRows, database, frontend, deployment, serviceErrors],
  )
  const diagnosis = useMemo(
    () => dashboardDiagnosis({ incidents, routes: routeRows, dashboard }),
    [incidents, routeRows, dashboard],
  )
  const updatedAt = valueFrom(
    dashboard.generated_at,
    dashboard.generatedAt,
    dashboard.source?.generated_at,
    performance.source?.generated_at,
    database.source?.generated_at,
    frontend.source?.generated_at,
  )

  const activeQuery = activeTab === 'routes'
    ? performanceQuery
    : activeTab === 'database'
      ? databaseQuery
      : activeTab === 'frontend'
        ? frontendQuery
        : overviewQuery

  if (!opsHostAllowed) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="empty"
          title="Not found"
          description="This page is not available on this host."
          icon={ShieldCheck}
        />
      </>
    )
  }

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return <LoadingDashboard pageMeta={pageMeta} />
  }

  if (overviewQuery.isError && !overviewQuery.data) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="error"
          title="Unable to load ops dashboard"
          description="The Rust V2 ops endpoint did not return a dashboard snapshot."
          action={() => overviewQuery.refetch()}
          icon={TriangleAlert}
        />
      </>
    )
  }

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Ops Dashboard"
        description="Rust V2 engineer control plane"
        titleClassName="tracking-normal"
        className="rounded-lg border border-border bg-card"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {updatedAt ? (
              <span className="font-mono text-xs text-muted-foreground">
                Updated {formatIso(updatedAt)}
              </span>
            ) : null}
            <WindowSelector value={windowValue} onChange={setWindowValue} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => activeQuery.refetch()}
              disabled={activeQuery.isFetching}
              className="font-mono text-xs"
            >
              {activeQuery.isFetching ? (
                <LoadingSpinner className="mr-2 h-4 w-8" aria-hidden="true" />
              ) : (
                <RefreshCw className="mr-2 size-4" aria-hidden="true" />
              )}
              Refresh
            </Button>
          </div>
        )}
      />
      <TabNav activeTab={activeTab} onChange={setActiveTab} />

      <main className="space-y-6 p-4 sm:p-6">
        {activeQuery.isError && activeQuery !== overviewQuery ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            The selected drilldown did not load; showing the last overview snapshot where available.
          </div>
        ) : null}

        {activeTab === 'overview' ? (
          <section className="space-y-4" role="tabpanel" aria-label="Overview">
            <SectionHeading icon={Gauge} title="Overview">
              {overviewQuery.isFetching ? <span className="font-mono text-xs text-muted-foreground">Refreshing</span> : null}
            </SectionHeading>
            <DiagnosisPanel diagnosis={diagnosis} />
            <div className="grid gap-4 md:grid-cols-3">
              {budgets.map((budget) => (
                <BudgetCard key={budget.key} budget={budget} />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricBox icon={Timer} label="Payload p95" value={formatSizeKb(valueFrom(payloads.p95_kb, payloads.payload_p95_kb))} status={payloads.status || statusForThreshold(valueFrom(payloads.p95_kb, payloads.payload_p95_kb), 96, 160)} />
              <MetricBox icon={HardDrive} label="Payload p99" value={formatSizeKb(valueFrom(payloads.p99_kb, payloads.payload_p99_kb))} status={payloads.status || statusForThreshold(valueFrom(payloads.p99_kb, payloads.payload_p99_kb), 128, 256)} />
              <MetricBox icon={Server} label="Services" value={formatNumber(asArray(deployment.services).length)} status={deployment.status || 'unknown'} />
              <MetricBox icon={TriangleAlert} label="Aggregate incidents" value={formatNumber(incidents.length)} status={incidents.some((incident) => normalizeStatus(incident.severity) === 'fail') ? 'fail' : incidents.length ? 'warn' : 'pass'} />
            </div>
            <SourceNotes source={dashboard.source} />
          </section>
        ) : null}

        {activeTab === 'routes' ? (
          <section className="space-y-4" role="tabpanel" aria-label="Routes">
            <SectionHeading icon={RouteIcon} title="Route Latency">
              {performanceQuery.isFetching ? <span className="font-mono text-xs text-muted-foreground">Refreshing</span> : null}
            </SectionHeading>
            <RouteLatencyTable rows={routeRows} />
          </section>
        ) : null}

        {activeTab === 'database' ? (
          <section className="space-y-4" role="tabpanel" aria-label="Database">
            <SectionHeading icon={Database} title="Database">
              {databaseQuery.isFetching ? <span className="font-mono text-xs text-muted-foreground">Refreshing</span> : null}
            </SectionHeading>
            <DatabasePanel database={database} cache={cache} />
          </section>
        ) : null}

        {activeTab === 'frontend' ? (
          <section className="space-y-4" role="tabpanel" aria-label="Frontend">
            <SectionHeading icon={Monitor} title="Frontend/RUM">
              {frontendQuery.isFetching ? <span className="font-mono text-xs text-muted-foreground">Refreshing</span> : null}
            </SectionHeading>
            <RumPanel frontend={frontend} />
          </section>
        ) : null}

        {activeTab === 'deploys' ? (
          <section className="space-y-4" role="tabpanel" aria-label="Deploys">
            <SectionHeading icon={Cloud} title="Deploys/status" />
            <DeploymentPanel deployment={deployment} />
          </section>
        ) : null}

        {activeTab === 'incidents' ? (
          <section className="space-y-4" role="tabpanel" aria-label="Incidents">
            <SectionHeading icon={TriangleAlert} title="Service Errors / Incidents" />
            <IncidentPanel incidents={incidents} />
          </section>
        ) : null}
      </main>
    </PageShell>
  )
}
