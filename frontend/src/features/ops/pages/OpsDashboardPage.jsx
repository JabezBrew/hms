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
import { useOpsDashboard } from '@/features/ops/hooks'

const WINDOW_OPTIONS = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
]

const EMPTY_DASHBOARD = Object.freeze({})

const SAFE_ROUTE_SEGMENTS = new Set([
  'api',
  'v2',
  'ops',
  'dashboard',
  'overview',
  'performance',
  'database',
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

function valueFrom(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase()
  if (['pass', 'passed', 'ok', 'healthy', 'success', 'green', 'normal', 'nominal'].includes(status)) {
    return 'pass'
  }
  if (['warn', 'warning', 'degraded', 'incomplete', 'yellow', 'elevated'].includes(status)) {
    return 'warn'
  }
  if (['fail', 'failed', 'critical', 'error', 'unhealthy', 'down', 'red', 'saturated'].includes(status)) {
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

function normalizePercentNumber(value) {
  const numeric = toNumber(value)
  if (numeric === null) {
    return null
  }
  return numeric <= 1 ? numeric * 100 : numeric
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
    return safeLabel(value, 'N/A')
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function safeLabel(value, fallback = 'N/A') {
  const text = String(value || '').trim()
  if (!text || text.length > 80) {
    return fallback
  }
  return /^[a-zA-Z0-9._:/@+-]+$/.test(text) ? text : fallback
}

function shortCommit(value) {
  const commit = safeLabel(value, '')
  return commit ? commit.slice(0, 12) : 'N/A'
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
    .map((segment) => {
      const decoded = decodeURIComponent(segment).trim()
      const normalized = decoded.toLowerCase()
      if (!decoded || isDynamicSegment(decoded)) {
        return ':id'
      }
      if (SAFE_ROUTE_SEGMENTS.has(normalized)) {
        return normalized
      }
      return ':redacted'
    })

  return `${method}/${segments.join('/')}`.replace(/\/$/, '') || '/'
}

function normalizeBudget(budget, index) {
  const value = valueFrom(budget.display_value, budget.value_label, budget.value)
  const valueMs = valueFrom(budget.value_ms, budget.p99_ms, budget.p95_ms)
  const valuePercent = valueFrom(budget.value_percent, budget.percent, budget.ratio)
  return {
    key: safeLabel(valueFrom(budget.key, budget.id), `budget-${index}`),
    label: String(valueFrom(budget.label, budget.name, `Budget ${index + 1}`)).slice(0, 48),
    value: value !== undefined
      ? String(value).slice(0, 24)
      : valueMs !== undefined
        ? formatMs(valueMs)
        : valuePercent !== undefined
          ? formatPercent(valuePercent)
          : 'Awaiting data',
    target: String(valueFrom(budget.target, budget.budget, budget.threshold, 'No target')).slice(0, 32),
    status: normalizeStatus(budget.status),
    detail: '',
  }
}

function buildFallbackBudgets(data) {
  const apiP99 = valueFrom(data.performance?.api_p99_ms, data.performance?.summary?.p99_ms)
  const dbPressure = valueFrom(data.database?.pool?.pressure, data.database?.pool?.pressure_percent)
  const rumShell = valueFrom(data.frontend?.rum?.app_shell_p95_ms, data.rum?.app_shell_p95_ms)
  return [
    {
      key: 'api-p99',
      label: 'API p99',
      value: formatMs(apiP99),
      target: '<= 200 ms',
      status: statusForThreshold(apiP99, 200, 350),
      detail: 'clinical route budget',
    },
    {
      key: 'db-pool',
      label: 'DB pool pressure',
      value: formatPercent(dbPressure),
      target: '< 70%',
      status: statusForPercent(dbPressure, 70, 85),
      detail: 'checked-out connections',
    },
    {
      key: 'rum-shell',
      label: 'App shell p95',
      value: formatMs(rumShell),
      target: '<= 1200 ms',
      status: statusForThreshold(rumShell, 1200, 1800),
      detail: 'browser shell readiness',
    },
  ]
}

function normalizeBudgets(data) {
  const budgets = asArray(valueFrom(data.budgets, data.overview?.budgets))
  return budgets.length ? budgets.map(normalizeBudget) : buildFallbackBudgets(data)
}

function normalizeRouteRows(data) {
  return asArray(valueFrom(data.performance?.routes, data.routes, data.route_latency)).slice(0, 12)
}

function normalizePool(data) {
  return valueFrom(data.database?.pool, data.db?.pool, data.pool, {})
}

function normalizeRequestContextCache(data) {
  return valueFrom(
    data.performance?.request_context_cache,
    data.request_context_cache,
    data.requestContextCache,
    {},
  )
}

function normalizePayloads(data) {
  return valueFrom(data.performance?.payloads, data.payloads, {})
}

function normalizeRum(data) {
  return valueFrom(data.frontend?.rum, data.rum, data.frontend_rum, {})
}

function normalizeDeployment(data) {
  return valueFrom(data.deploys, data.deployment, data.status, {})
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
      <Icon className="h-3 w-3" aria-hidden="true" />
      {normalized.toUpperCase()}
    </span>
  )
}

function WindowSelector({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
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
      <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[11px] text-muted-foreground">
        <span>{budget.target}</span>
        {budget.detail ? <span className="truncate text-right">{budget.detail}</span> : null}
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
        <Icon className={cn('h-5 w-5 shrink-0', STATUS_STYLES[normalized].icon)} aria-hidden="true" />
      </div>
    </div>
  )
}

function SectionHeading({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex items-center gap-2">
        <div className="rounded-md border border-border bg-muted/40 p-2">
          <Icon className="h-4 w-4 text-foreground" aria-hidden="true" />
        </div>
        <h2 className="font-heading text-lg text-foreground">{title}</h2>
      </div>
      {children}
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

function RouteLatencyTable({ rows }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
        Route latency data is not available for this window.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Route</TableHead>
            <TableHead>p95</TableHead>
            <TableHead>p99</TableHead>
            <TableHead>Requests</TableHead>
            <TableHead>Errors</TableHead>
            <TableHead>Payload p95</TableHead>
            <TableHead>Payload p99</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const status = normalizeStatus(valueFrom(row.status, statusForThreshold(row.p99_ms, 200, 350)))
            return (
              <TableRow key={`${sanitizeRoutePath(valueFrom(row.route, row.path, row.name))}-${index}`}>
                <TableCell className="max-w-[280px]">
                  <div className="flex items-center gap-2">
                    <RouteIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-mono text-xs">
                      {sanitizeRoutePath(valueFrom(row.route, row.path, row.name))}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.p95_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{formatMs(row.p99_ms)}</TableCell>
                <TableCell className="font-mono text-xs">{formatNumber(valueFrom(row.requests, row.count))}</TableCell>
                <TableCell className="font-mono text-xs">{formatPercent(valueFrom(row.error_rate, row.error_percent))}</TableCell>
                <TableCell className="font-mono text-xs">{formatSizeKb(valueFrom(row.payload_p95_kb, row.payload?.p95_kb))}</TableCell>
                <TableCell className="font-mono text-xs">{formatSizeKb(valueFrom(row.payload_p99_kb, row.payload?.p99_kb))}</TableCell>
                <TableCell><StatusPill status={status} /></TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function DatabasePanel({ pool, cache }) {
  const used = valueFrom(pool.used, pool.checked_out, pool.in_use)
  const max = valueFrom(pool.max, pool.size, pool.capacity)
  const pressure = valueFrom(pool.pressure_percent, pool.pressure, max ? (Number(used || 0) / Number(max)) : null)
  const waitP95 = valueFrom(pool.wait_p95_ms, pool.acquire_p95_ms, pool.checkout_p95_ms)
  const cacheHitRatio = valueFrom(cache.hit_ratio, cache.hit_percent, cache.ratio)
  const cachePercent = normalizePercentNumber(cacheHitRatio)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)]">
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-heading text-base text-foreground">Pool Pressure</h3>
              <p className="text-xs text-muted-foreground">Checked-out connections against configured capacity</p>
            </div>
            <StatusPill status={pool.status || statusForPercent(pressure, 70, 85)} />
          </div>
          <PressureBar value={pressure} status={pool.status} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricBox icon={Database} label="In use" value={`${formatNumber(used)} / ${formatNumber(max)}`} status={pool.status} />
          <MetricBox icon={Timer} label="Acquire p95" value={formatMs(waitP95)} status={statusForThreshold(waitP95, 25, 75)} />
          <MetricBox icon={Cpu} label="Waiters" value={formatNumber(valueFrom(pool.waiting, pool.waiters, 0))} status={statusForThreshold(valueFrom(pool.waiting, pool.waiters, 0), 0, 3)} />
        </div>
      </div>
      <MetricBox
        icon={ShieldCheck}
        label="Request-context cache"
        value={formatPercent(cacheHitRatio)}
        detail={`${formatNumber(cache.hits)} hits / ${formatNumber(cache.misses)} misses`}
        status={cache.status || (cachePercent === null ? 'unknown' : cachePercent >= 95 ? 'pass' : cachePercent >= 85 ? 'warn' : 'fail')}
      />
    </div>
  )
}

function RumPanel({ rum }) {
  const appShellP95 = valueFrom(rum.app_shell_p95_ms, rum.shell_p95_ms)
  const apiP95 = valueFrom(rum.browser_api_p95_ms, rum.api_p95_ms)
  const apiP99 = valueFrom(rum.browser_api_p99_ms, rum.api_p99_ms)
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricBox icon={Monitor} label="App shell p95" value={formatMs(appShellP95)} status={statusForThreshold(appShellP95, 1200, 1800)} />
      <MetricBox icon={Globe} label="Browser API p95" value={formatMs(apiP95)} status={statusForThreshold(apiP95, 300, 500)} />
      <MetricBox icon={Timer} label="Browser API p99" value={formatMs(apiP99)} status={statusForThreshold(apiP99, 600, 900)} />
      <MetricBox icon={Activity} label="RUM samples" value={formatNumber(valueFrom(rum.sample_count, rum.samples))} status={rum.status || 'unknown'} />
    </div>
  )
}

function DeploymentPanel({ deployment }) {
  const services = asArray(valueFrom(deployment.services, deployment.health, []))
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="font-heading text-base text-foreground">Version</h3>
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Environment</dt>
            <dd className="font-mono text-xs">{safeLabel(valueFrom(deployment.environment, deployment.env), 'N/A')}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono text-xs">{safeLabel(deployment.version, 'N/A')}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="font-mono text-xs">{shortCommit(valueFrom(deployment.commit, deployment.git_sha))}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Deployed</dt>
            <dd className="font-mono text-xs">{formatIso(valueFrom(deployment.deployed_at, deployment.updated_at))}</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Commit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.length ? services.map((service, index) => (
              <TableRow key={`${safeLabel(service.name, 'service')}-${index}`}>
                <TableCell className="font-mono text-xs">{safeLabel(service.name, 'service')}</TableCell>
                <TableCell><StatusPill status={valueFrom(service.status, service.health)} /></TableCell>
                <TableCell className="font-mono text-xs">{formatMs(valueFrom(service.latency_ms, service.p95_ms))}</TableCell>
                <TableCell className="font-mono text-xs">{safeLabel(service.version, 'N/A')}</TableCell>
                <TableCell className="font-mono text-xs">{shortCommit(valueFrom(service.commit, service.git_sha))}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-sm text-muted-foreground">
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
  const opsHostAllowed = isOpsDashboardHost()
  const pageMeta = usePageMeta({
    title: 'Ops Dashboard | Hospital Management System',
    breadcrumbs: [
      { label: 'System', path: '/system/ops' },
      { label: 'Ops Dashboard', path: '/system/ops' },
    ],
  })

  const dashboardQuery = useOpsDashboard({ window: windowValue }, { enabled: opsHostAllowed })
  const dashboard = dashboardQuery.data || EMPTY_DASHBOARD
  const budgets = useMemo(() => normalizeBudgets(dashboard), [dashboard])
  const routes = useMemo(() => normalizeRouteRows(dashboard), [dashboard])
  const pool = useMemo(() => normalizePool(dashboard), [dashboard])
  const cache = useMemo(() => normalizeRequestContextCache(dashboard), [dashboard])
  const payloads = useMemo(() => normalizePayloads(dashboard), [dashboard])
  const rum = useMemo(() => normalizeRum(dashboard), [dashboard])
  const deployment = useMemo(() => normalizeDeployment(dashboard), [dashboard])
  const updatedAt = valueFrom(dashboard.generated_at, dashboard.generatedAt)
  const cacheHitPercent = normalizePercentNumber(valueFrom(cache.hit_ratio, cache.hit_percent))

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

  if (dashboardQuery.isLoading && !dashboardQuery.data) {
    return <LoadingDashboard pageMeta={pageMeta} />
  }

  if (dashboardQuery.isError && !dashboardQuery.data) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="error"
          title="Unable to load ops dashboard"
          description="The Rust V2 ops endpoint did not return a dashboard snapshot."
          action={() => dashboardQuery.refetch()}
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
              onClick={() => dashboardQuery.refetch()}
              disabled={dashboardQuery.isFetching}
              className="font-mono text-xs"
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', dashboardQuery.isFetching && 'animate-spin')} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        )}
      />

      <main className="space-y-8 p-4 sm:p-6">
        <section className="space-y-4">
          <SectionHeading icon={Gauge} title="Overview">
            {dashboardQuery.isFetching ? (
              <span className="font-mono text-xs text-muted-foreground">Refreshing</span>
            ) : null}
          </SectionHeading>
          <div className="grid gap-4 md:grid-cols-3">
            {budgets.map((budget) => (
              <BudgetCard key={budget.key} budget={budget} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeading icon={Activity} title="Performance" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricBox
              icon={Timer}
              label="Payload p95"
              value={formatSizeKb(valueFrom(payloads.p95_kb, payloads.payload_p95_kb))}
              status={payloads.status || statusForThreshold(valueFrom(payloads.p95_kb, payloads.payload_p95_kb), 96, 160)}
            />
            <MetricBox
              icon={HardDrive}
              label="Payload p99"
              value={formatSizeKb(valueFrom(payloads.p99_kb, payloads.payload_p99_kb))}
              status={payloads.status || statusForThreshold(valueFrom(payloads.p99_kb, payloads.payload_p99_kb), 128, 256)}
            />
            <MetricBox
              icon={ShieldCheck}
              label="Cache hit ratio"
              value={formatPercent(valueFrom(cache.hit_ratio, cache.hit_percent))}
              status={cache.status || (cacheHitPercent === null ? 'unknown' : cacheHitPercent >= 95 ? 'pass' : 'warn')}
            />
            <MetricBox
              icon={Server}
              label="Active services"
              value={formatNumber(asArray(valueFrom(deployment.services, [])).length)}
              status={deployment.status || 'unknown'}
            />
          </div>
          <RouteLatencyTable rows={routes} />
        </section>

        <section className="space-y-4">
          <SectionHeading icon={Database} title="Database" />
          <DatabasePanel pool={pool} cache={cache} />
        </section>

        <section className="space-y-4">
          <SectionHeading icon={Monitor} title="Frontend/RUM" />
          <RumPanel rum={rum} />
        </section>

        <section className="space-y-4">
          <SectionHeading icon={Cloud} title="Deploys/status" />
          <DeploymentPanel deployment={deployment} />
        </section>
      </main>
    </PageShell>
  )
}
