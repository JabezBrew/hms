import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Layout } from '@/components/layout/layout';
import FacilityRequiredPanel from '@/components/facilities/FacilityRequiredPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import {
  useAdminDashboardLiveUpdates,
  useAdminDashboardV2Capacity,
  useAdminDashboardV2Compliance,
  useAdminDashboardV2Summary,
  useAdminDashboardV2Workforce,
} from '@/features/dashboards/hooks';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const WINDOW_OPTIONS = [
  { value: 'now', label: 'Now (last 2h)' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
];

const STATUS_CLASSES = {
  normal: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  warning: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  critical: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
};

function formatTime(value) {
  if (!value) {
    return 'N/A';
  }
  try {
    return format(new Date(value), 'MMM d, h:mm a');
  } catch {
    return value;
  }
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${number.toFixed(1)}%`;
}

function formatRatio(filled, required) {
  if (!required) {
    return '0/0';
  }
  return `${filled}/${required}`;
}

function statusBadge(status) {
  const label = String(status || 'normal').toUpperCase();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-mono tracking-wide',
        STATUS_CLASSES[status] || STATUS_CLASSES.normal,
      )}
    >
      {label}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, subvalue, status = 'normal' }) {
  return (
    <Card className="gap-3 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="font-display text-3xl text-foreground">{value}</p>
            {subvalue ? <p className="text-xs text-muted-foreground">{subvalue}</p> : null}
          </div>
          <div
            className={cn(
              'rounded-lg border p-2',
              status === 'critical' && 'border-rose-500/30 bg-rose-500/10 text-rose-500',
              status === 'warning' && 'border-amber-500/30 bg-amber-500/10 text-amber-500',
              status === 'normal' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionPanel({
  title,
  description,
  summary,
  open,
  onToggle,
  loading,
  error,
  children,
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="font-heading text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {statusBadge(summary?.status)}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onToggle}>
            {open ? (
              <ChevronDown className="mr-1 h-4 w-4" />
            ) : (
              <ChevronRight className="mr-1 h-4 w-4" />
            )}
            {open ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </CardHeader>
      {open ? (
        <CardContent className="space-y-4 border-t px-4 py-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-500">
              {error.message || 'Failed to load section details.'}
            </div>
          ) : (
            children
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { facilityCode } = useAuth();
  const [window, setWindow] = useState('today');
  const [expanded, setExpanded] = useState({
    capacity: false,
    workforce: false,
    compliance: false,
  });

  const pageMeta = usePageMeta({
    title: 'Admin Dashboard | Hospital Management System',
    breadcrumbs: [
      { label: 'Dashboards', path: '/' },
      { label: 'Admin', path: '/dashboards/admin' },
    ],
  });

  const { isConnected: isLiveConnected } = useAdminDashboardLiveUpdates({
    enabled: Boolean(facilityCode),
  });

  const summaryQuery = useAdminDashboardV2Summary(
    { window },
    {
      refetchInterval: isLiveConnected ? false : 30000,
      enabled: Boolean(facilityCode),
    },
  );

  const capacityQuery = useAdminDashboardV2Capacity(
    { window },
    {
      enabled: Boolean(facilityCode) && expanded.capacity,
    },
  );

  const workforceQuery = useAdminDashboardV2Workforce(
    { window },
    {
      enabled: Boolean(facilityCode) && expanded.workforce,
    },
  );

  const complianceQuery = useAdminDashboardV2Compliance(
    { window },
    {
      enabled: Boolean(facilityCode) && expanded.compliance,
    },
  );

  const dashboardData = summaryQuery.data || {};
  const kpis = dashboardData.kpis || {};
  const sectionSummaries = dashboardData.section_summaries || {};
  const alerts = dashboardData.alerts_top || [];
  const actionQueue = dashboardData.action_queue_top || [];
  const generatedAt = dashboardData?.meta?.generated_at;

  const anyFetching = summaryQuery.isFetching
    || capacityQuery.isFetching
    || workforceQuery.isFetching
    || complianceQuery.isFetching;

  const onRefresh = () => {
    summaryQuery.refetch();
    if (expanded.capacity) {
      capacityQuery.refetch();
    }
    if (expanded.workforce) {
      workforceQuery.refetch();
    }
    if (expanded.compliance) {
      complianceQuery.refetch();
    }
  };

  const metricCards = useMemo(() => {
    const occupancy = kpis.occupancy || {};
    const admissions = kpis.admissions_today || {};
    const discharges = kpis.discharges_today || {};
    const throughput = kpis.appointment_throughput || {};
    const staffing = kpis.staffing_coverage || {};
    const compliance = kpis.compliance_risk || {};

    return [
      {
        label: 'Bed Occupancy',
        value: formatPercent(occupancy.percent),
        subvalue: `${occupancy.occupied_beds || 0}/${occupancy.total_beds || 0} occupied`,
        icon: Bed,
        status: Number(occupancy.percent || 0) >= 100 ? 'critical' : Number(occupancy.percent || 0) >= 85 ? 'warning' : 'normal',
      },
      {
        label: 'Admissions Today',
        value: String(admissions.count || 0),
        subvalue: `${admissions.trend_pct || 0}% vs yesterday`,
        icon: UserPlus,
        status: 'normal',
      },
      {
        label: 'Discharge Progress',
        value: formatPercent(discharges.completion_rate || 0),
        subvalue: `${discharges.completed || 0}/${discharges.planned || 0} completed`,
        icon: ClipboardList,
        status: Number(discharges.completion_rate || 0) < 70 ? 'warning' : 'normal',
      },
      {
        label: 'Appointment Throughput',
        value: formatPercent(throughput.completion_rate || 0),
        subvalue: `${throughput.completed || 0}/${throughput.scheduled || 0} completed`,
        icon: Calendar,
        status: Number(throughput.completion_rate || 0) < 70 ? 'warning' : 'normal',
      },
      {
        label: 'Staffing Coverage',
        value: formatRatio(staffing.filled_shifts || 0, staffing.required_shifts || 0),
        subvalue: `${staffing.critical_uncovered || 0} uncovered`,
        icon: Users,
        status: Number(staffing.critical_uncovered || 0) > 0 ? 'warning' : 'normal',
      },
      {
        label: 'Compliance Queue',
        value: String(compliance.total || 0),
        subvalue: `${compliance.break_glass_pending_review || 0} break-glass, ${compliance.audit_anomalies_24h || 0} anomalies`,
        icon: Shield,
        status: Number(compliance.total || 0) > 0 ? 'warning' : 'normal',
      },
    ];
  }, [kpis]);

  if (!facilityCode) {
    return (
      <Layout>
        {pageMeta}
        <PageShell>
          <PageHeader
            title="Admin Dashboard"
            description="Operational command center for capacity, workforce, and compliance"
          />
          <div className="p-4 sm:p-6">
            <FacilityRequiredPanel />
          </div>
        </PageShell>
      </Layout>
    );
  }

  if (summaryQuery.error) {
    return (
      <Layout>
        {pageMeta}
        <PageShell>
          <PageHeader
            title="Admin Dashboard"
            description="Operational command center for capacity, workforce, and compliance"
          />
          <PageState
            variant="error"
            title="Failed to load admin dashboard"
            description={summaryQuery.error.message}
            action={() => summaryQuery.refetch()}
            fullHeight={false}
            className="min-h-0"
          />
        </PageShell>
      </Layout>
    );
  }

  return (
    <Layout>
      {pageMeta}
      <PageShell>
        <PageHeader
          title="Admin Dashboard"
          description="Operational command center for capacity, workforce, and compliance"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Select value={window} onValueChange={setWindow}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Select window" />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => navigate('/admin/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={onRefresh}
                disabled={anyFetching}
                aria-label="Refresh dashboard"
              >
                <RefreshCw className={cn('h-4 w-4', anyFetching && 'animate-spin')} />
              </Button>
            </div>
          )}
        />

        <div className="space-y-6 p-4 sm:p-6">
          <Card className="gap-3 border-primary/20 bg-gradient-to-r from-amber-500/5 to-sky-500/5 py-4">
            <CardContent className="px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-heading text-sm text-foreground">Current operational posture</p>
                  <p className="text-xs text-muted-foreground">
                    {generatedAt ? `Last updated ${formatTime(generatedAt)}` : 'Awaiting initial refresh'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-mono tracking-wide',
                      isLiveConnected
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-500',
                    )}
                  >
                    {isLiveConnected ? 'LIVE' : 'POLLING'}
                  </span>
                  {dashboardData?.meta?.stale ? (
                    <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-mono tracking-wide text-amber-500">
                      STALE READ
                    </span>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          {summaryQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-28" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {metricCards.map((metric) => (
                <MetricCard
                  key={metric.label}
                  icon={metric.icon}
                  label={metric.label}
                  value={metric.value}
                  subvalue={metric.subvalue}
                  status={metric.status}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.8fr_1fr]">
            <Card className="gap-3 py-4">
              <CardHeader className="px-4 py-0">
                <CardTitle className="font-heading text-base">Top Alerts</CardTitle>
                <CardDescription>Highest-priority issues requiring immediate attention</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 px-4">
                {alerts.length === 0 ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">
                    No critical alerts right now.
                  </div>
                ) : (
                  alerts.map((alert) => (
                    <div key={alert.id} className="rounded-lg border border-border bg-card/70 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <AlertTriangle
                              className={cn(
                                'h-4 w-4',
                                alert.severity === 'critical' ? 'text-rose-500' : 'text-amber-500',
                              )}
                            />
                            <p className="text-sm font-medium text-foreground">{alert.title}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">Started {formatTime(alert.started_at)}</p>
                        </div>
                        {alert.primary_action?.href ? (
                          <Button variant="outline" size="sm" onClick={() => navigate(alert.primary_action.href)}>
                            {alert.primary_action.label || 'Open'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="gap-3 py-4">
              <CardHeader className="px-4 py-0">
                <CardTitle className="font-heading text-base">Action Queue</CardTitle>
                <CardDescription>Prioritized interventions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 px-4">
                {actionQueue.length === 0 ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">
                    No pending interventions.
                  </div>
                ) : (
                  actionQueue.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => navigate(action.href)}
                      className="flex w-full items-center justify-between rounded-lg border border-border bg-card/70 p-3 text-left transition-colors hover:bg-accent/40"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">{action.title}</p>
                        {statusBadge(action.severity)}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <SectionPanel
              title="Capacity"
              description="Ward occupancy, throughput, and wait-time pressure"
              summary={sectionSummaries.capacity}
              open={expanded.capacity}
              onToggle={() => setExpanded((current) => ({ ...current, capacity: !current.capacity }))}
              loading={capacityQuery.isLoading}
              error={capacityQuery.error}
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Wait time</p>
                  <p className="mt-1 text-sm text-foreground">
                    Median {capacityQuery.data?.wait_time?.median_minutes || 0} min
                  </p>
                  <p className="text-xs text-muted-foreground">
                    P95 {capacityQuery.data?.wait_time?.p95_minutes || 0} min
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">High occupancy wards</p>
                  <p className="mt-1 text-sm text-foreground">
                    {capacityQuery.data?.summary?.high_occupancy_wards || 0} of {capacityQuery.data?.summary?.ward_count || 0}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {(capacityQuery.data?.wards || []).slice(0, 8).map((ward) => (
                  <div key={ward.ward_id} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{ward.ward_name}</p>
                      <p className="text-xs text-muted-foreground">{formatPercent(ward.occupancy_pct)}</p>
                    </div>
                    <Progress value={Number(ward.occupancy_pct || 0)} className="h-2" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {ward.occupied_beds}/{ward.total_beds} occupied, {ward.available_beds} available
                    </p>
                  </div>
                ))}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Workforce"
              description="Shift coverage gaps and immediate staffing risk"
              summary={sectionSummaries.workforce}
              open={expanded.workforce}
              onToggle={() => setExpanded((current) => ({ ...current, workforce: !current.workforce }))}
              loading={workforceQuery.isLoading}
              error={workforceQuery.error}
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Coverage</p>
                  <p className="mt-1 text-sm text-foreground">
                    {formatRatio(
                      workforceQuery.data?.summary?.filled_shifts || 0,
                      workforceQuery.data?.summary?.required_shifts || 0,
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Next 2h risks</p>
                  <p className="mt-1 text-sm text-foreground">
                    {workforceQuery.data?.summary?.next_2h_risks || 0} uncovered starts
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {(workforceQuery.data?.uncovered_shifts || []).slice(0, 8).map((shift) => (
                  <div key={shift.shift_id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {shift.unit_name} - {shift.duty_type_name}
                      </p>
                      {statusBadge(shift.priority === 'high' ? 'warning' : 'normal')}
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {shift.starts_at ? formatTime(shift.starts_at) : 'No start time'}
                    </p>
                  </div>
                ))}
                {(workforceQuery.data?.uncovered_shifts || []).length === 0 ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">
                    All tracked shifts have coverage.
                  </div>
                ) : null}
              </div>
            </SectionPanel>

            <SectionPanel
              title="Compliance"
              description="Break-glass monitoring, audit anomalies, and documentation"
              summary={sectionSummaries.compliance}
              open={expanded.compliance}
              onToggle={() => setExpanded((current) => ({ ...current, compliance: !current.compliance }))}
              loading={complianceQuery.isLoading}
              error={complianceQuery.error}
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Documentation completeness</p>
                  <p className="mt-1 text-sm text-foreground">
                    {formatPercent(complianceQuery.data?.summary?.documentation_completeness_pct || 0)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Pending break-glass review</p>
                  <p className="mt-1 text-sm text-foreground">
                    {complianceQuery.data?.summary?.break_glass_pending_review || 0}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {(complianceQuery.data?.break_glass_recent || []).slice(0, 8).map((event) => (
                  <div key={event.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {event.scope || 'clinical'} access override
                      </p>
                      <span className="text-xs text-muted-foreground">{event.requester_role}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatTime(event.created_at)}</p>
                  </div>
                ))}
                {(complianceQuery.data?.audit_anomalies_breakdown || []).slice(0, 4).map((row) => (
                  <div key={row.action} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <span className="text-sm text-foreground">{row.action}</span>
                    <span className="text-xs text-muted-foreground">{row.count}</span>
                  </div>
                ))}
                {(complianceQuery.data?.break_glass_recent || []).length === 0
                  && (complianceQuery.data?.audit_anomalies_breakdown || []).length === 0 ? (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">
                      No recent compliance events in this window.
                    </div>
                  ) : null}
              </div>
            </SectionPanel>
          </div>
        </div>
      </PageShell>
    </Layout>
  );
}
