import ActivitySquare from 'lucide-react/dist/esm/icons/activity-square.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import CheckCircle2 from 'lucide-react/dist/esm/icons/badge-check.js'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3.js'
import Database from 'lucide-react/dist/esm/icons/database.js'
import Layers3 from 'lucide-react/dist/esm/icons/layers-3.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Server from 'lucide-react/dist/esm/icons/server.js'
import Workflow from 'lucide-react/dist/esm/icons/workflow.js'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useSystemJobs } from '@/features/admin/hooks'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageShell } from '@/shared/components/page/PageShell'
import { PageState } from '@/shared/components/page/PageState'
import { usePageMeta } from '@/shared/hooks/usePageMeta'

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '—'
  }

  const seconds = Math.floor(totalSeconds)
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const remainderMinutes = minutes % 60
    return remainderMinutes ? `${hours}h ${remainderMinutes}m` : `${hours}h`
  }

  const days = Math.floor(hours / 24)
  const remainderHours = hours % 24
  return remainderHours ? `${days}d ${remainderHours}h` : `${days}d`
}

function formatTimestamp(timestampMs) {
  if (!timestampMs) {
    return '—'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestampMs))
}

function dependencyTone(status) {
  return status === 'connected'
    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
    : 'bg-rose-500/10 text-rose-700 border-rose-500/30'
}

function queueTone(depth, workerCount) {
  if (depth === 0) {
    return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
  }
  if (workerCount === 0) {
    return 'bg-rose-500/10 text-rose-700 border-rose-500/30'
  }
  return 'bg-amber-500/10 text-amber-700 border-amber-500/30'
}

function dependencyIcon(name) {
  return name === 'database' ? Database : Layers3
}

function StatCard({ title, value, meta, icon: Icon, tone = 'text-foreground' }) {
  return (
    <Card className="gap-4 border-border/70 bg-card/90">
      <CardHeader className="pb-0">
        <CardDescription className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.24em]">
          <span>{title}</span>
          {Icon ? <Icon className={cn('h-4 w-4', tone)} aria-hidden="true" /> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className={cn('font-display text-3xl tracking-tight', tone)}>{value}</p>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </CardContent>
    </Card>
  )
}

export default function SystemJobsPage() {
  const pageMeta = usePageMeta({
    title: 'Background Jobs | HMS Admin',
    breadcrumbs: [
      { label: 'Admin', href: '/admin/organization' },
      { label: 'Background Jobs' },
    ],
  })

  const {
    data,
    isLoading,
    isError,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useSystemJobs()

  if (isLoading && !data) {
    return <PageState variant="loading" />
  }

  if (isError && !data) {
    return (
      <PageState
        variant="error"
        title="Background jobs unavailable"
        description={error?.message || 'The operability endpoint could not be loaded.'}
        action={() => refetch()}
      />
    )
  }

  const health = data?.health || {}
  const celery = data?.celery || {}
  const aggregates = celery.aggregates || {}
  const workerCount = celery.worker_count || 0
  const queueDepthTotal = aggregates.queue_depth_total || 0
  const activeTasks = aggregates.active_tasks || 0
  const scheduledTasks = aggregates.scheduled_tasks || 0
  const reservedTasks = aggregates.reserved_tasks || 0
  const queueEntries = Object.entries(celery.queue_depths || {}).sort((left, right) => right[1] - left[1])
  const workers = Object.entries(celery.workers || {}).sort((left, right) => left[0].localeCompare(right[0]))
  const disconnectedDependencies = Object.entries(health).filter(([, dependency]) => dependency?.status !== 'connected')

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={(
          <span className="flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" />
            Background Jobs
          </span>
        )}
        description="Operational view of Celery workers, Redis-backed queues, and backend dependency health."
        meta="Admin operability"
        actions={(
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-mono text-xs"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
              Refresh now
            </Button>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Updated {formatTimestamp(dataUpdatedAt)}
            </p>
          </div>
        )}
      />

      <main className="space-y-6 p-4 sm:p-6">
        {isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Live refresh degraded</AlertTitle>
            <AlertDescription>
              Showing the last successful snapshot. Retry when connectivity to the backend is restored.
            </AlertDescription>
          </Alert>
        ) : null}

        {!workerCount ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No Celery workers visible</AlertTitle>
            <AlertDescription>
              The backend cannot see any active workers via Celery inspect. Queue depth will accumulate until workers reconnect.
            </AlertDescription>
          </Alert>
        ) : null}

        {queueDepthTotal > 0 && !workerCount ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Queued work is stalled</AlertTitle>
            <AlertDescription>
              Tasks are queued in Redis but there are no visible workers available to drain them.
            </AlertDescription>
          </Alert>
        ) : null}

        {disconnectedDependencies.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Dependency degradation detected</AlertTitle>
            <AlertDescription>
              {disconnectedDependencies.map(([name]) => name).join(', ')} reported unhealthy in the latest backend readiness snapshot.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Visible workers"
            value={workerCount}
            meta={workerCount ? `${workers.length} responding worker${workers.length === 1 ? '' : 's'}` : 'No workers responding'}
            icon={Server}
            tone={workerCount ? 'text-emerald-700' : 'text-rose-700'}
          />
          <StatCard
            title="Queued tasks"
            value={queueDepthTotal}
            meta={`${queueEntries.length || 0} queue${queueEntries.length === 1 ? '' : 's'} tracked`}
            icon={Layers3}
            tone={queueDepthTotal ? 'text-amber-700' : 'text-emerald-700'}
          />
          <StatCard
            title="Active tasks"
            value={activeTasks}
            meta={`${reservedTasks} reserved and ${scheduledTasks} scheduled`}
            icon={ActivitySquare}
            tone={activeTasks ? 'text-sky-700' : 'text-foreground'}
          />
          <StatCard
            title="Facility scope"
            value={data?.facility_scope || 'All'}
            meta="Admin snapshot scope"
            icon={Clock3}
            tone="text-foreground"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {Object.entries(health).map(([name, dependency]) => {
            const DependencyIcon = dependencyIcon(name)
            const connected = dependency?.status === 'connected'

            return (
              <Card key={name} className="gap-4 border-border/70 bg-card/90">
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <CardDescription className="font-mono text-[11px] uppercase tracking-[0.24em]">
                        Dependency
                      </CardDescription>
                      <CardTitle className="flex items-center gap-2 text-xl capitalize">
                        <DependencyIcon className="h-5 w-5 text-primary" />
                        {name}
                      </CardTitle>
                    </div>
                    <Badge variant="outline" className={cn('capitalize', dependencyTone(dependency?.status))}>
                      {dependency?.status || 'unknown'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Latency</p>
                    <p className="mt-1 font-display text-2xl">{typeof dependency?.latency_seconds === 'number' ? `${(dependency.latency_seconds * 1000).toFixed(1)} ms` : '—'}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Status</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {connected ? 'Ready for request-path use.' : dependency?.error || 'Connection check failed.'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <Card className="gap-4 border-border/70 bg-card/90">
            <CardHeader>
              <CardTitle className="text-xl">Queue depth</CardTitle>
              <CardDescription>Redis-backed Celery queues visible to the backend.</CardDescription>
            </CardHeader>
            <CardContent>
              {queueEntries.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Queue</TableHead>
                      <TableHead className="text-right">Depth</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueEntries.map(([queueName, depth]) => (
                      <TableRow key={queueName}>
                        <TableCell className="font-mono text-xs">{queueName}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{depth}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={queueTone(depth, workerCount)}>
                            {depth === 0 ? 'Drained' : workerCount === 0 ? 'Stalled' : 'Backlog'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <PageState
                  variant="empty"
                  title="No queues discovered"
                  description="The broker did not report any configured queues for this snapshot."
                  fullHeight={false}
                  className="min-h-0 border border-dashed border-border/70 rounded-xl"
                />
              )}
            </CardContent>
          </Card>

          <Card className="gap-4 border-border/70 bg-card/90">
            <CardHeader>
              <CardTitle className="text-xl">Worker inventory</CardTitle>
              <CardDescription>Inspect-visible workers with concurrency, backlog, and throughput signals.</CardDescription>
            </CardHeader>
            <CardContent>
              {workers.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead className="text-right">Active</TableHead>
                      <TableHead className="text-right">Scheduled</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Concurrency</TableHead>
                      <TableHead className="text-right">Processed</TableHead>
                      <TableHead className="text-right">Uptime</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workers.map(([workerName, worker]) => (
                      <TableRow key={workerName}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{workerName}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              Inspect responsive
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{worker.active_count ?? 0}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{worker.scheduled_count ?? 0}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{worker.reserved_count ?? 0}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{worker.pool_max_concurrency ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{worker.processed_total ?? 0}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatDuration(worker.uptime_seconds)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <PageState
                  variant="empty"
                  title="No workers reported"
                  description="Celery inspect did not return any active workers for this snapshot."
                  fullHeight={false}
                  className="min-h-0 border border-dashed border-border/70 rounded-xl"
                />
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </PageShell>
  )
}
