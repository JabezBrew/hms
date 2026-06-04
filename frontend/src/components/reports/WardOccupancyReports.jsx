/* oxlint-disable react-doctor/prefer-useReducer -- Report loading uses a reducer below because ward and analytics state transition together. */
import Download from 'lucide-react/dist/esm/icons/download.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import { lazy, Suspense, useEffect, useReducer, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { wardsApi } from '@/features/wards/api';
import { useUrlEnumParam } from '@/shared/hooks/useUrlEnumParam';
import format from 'date-fns/format';
import subDays from 'date-fns/subDays';
import DeferredMount from '@/components/ui/DeferredMount';

const OccupancyTrendsPanel = lazy(() =>
  import('./WardOccupancyCharts').then((module) => ({ default: module.OccupancyTrendsPanel }))
);
const LengthOfStayPanel = lazy(() =>
  import('./WardOccupancyCharts').then((module) => ({ default: module.LengthOfStayPanel }))
);
const UtilizationPanel = lazy(() =>
  import('./WardOccupancyCharts').then((module) => ({ default: module.UtilizationPanel }))
);
const AdmissionsPanel = lazy(() =>
  import('./WardOccupancyCharts').then((module) => ({ default: module.AdmissionsPanel }))
);

const EMPTY_ANALYTICS = {
  analyticsMeta: null,
  occupancyData: [],
  lengthOfStayData: [],
  utilizationData: [],
  admissionsByWard: [],
};
const WARD_REPORT_TABS = ['occupancy', 'los', 'utilization', 'admissions'];

const initialReportState = {
  wardsLoading: true,
  analyticsLoading: false,
  error: null,
  wards: [],
  ...EMPTY_ANALYTICS,
};

function reportReducer(state, action) {
  switch (action.type) {
    case 'wards-loading':
      return { ...state, wardsLoading: true, error: null };
    case 'wards-loaded':
      return { ...state, wardsLoading: false, wards: action.wards };
    case 'analytics-loading':
      return { ...state, analyticsLoading: true, error: null };
    case 'analytics-loaded':
      return { ...state, analyticsLoading: false, ...action.analytics };
    case 'failed':
      return { ...state, wardsLoading: false, analyticsLoading: false, error: action.message };
    default:
      return state;
  }
}

function normalizeAnalytics(analyticsData = {}) {
  return {
    analyticsMeta: analyticsData.meta || null,
    occupancyData: analyticsData.occupancy_trends || [],
    lengthOfStayData: analyticsData.length_of_stay || [],
    utilizationData: analyticsData.ward_utilization || [],
    admissionsByWard: analyticsData.admissions_by_ward || [],
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function isUnavailableMetric(analyticsMeta, metric) {
  return analyticsMeta?.unavailable_metrics?.includes(metric) || false;
}

function csvMetric(value, unavailable = false) {
  if (unavailable || value === null || value === undefined || value === '') {
    return 'Not available';
  }

  return value;
}

function trendLabelForWard(day, ward) {
  return day?.__wardLabels?.[ward.id] || ward.name;
}

function trendValueForWard(day, ward) {
  return day?.[trendLabelForWard(day, ward)] || 0;
}

function buildWardOccupancyCsv({
  admissionsByWard,
  analyticsMeta,
  dateRange,
  occupancyData,
  selectedWard,
  utilizationData,
  wards,
}) {
  const lines = [
    'Ward Occupancy Report',
    `Date Range: ${format(dateRange.start, 'MMM dd, yyyy')} - ${format(dateRange.end, 'MMM dd, yyyy')}`,
    ...(analyticsMeta?.mode === 'rust_v2_snapshot'
      ? ['Mode: Rust V2 live capacity snapshot; historical aggregate analytics unavailable']
      : []),
    ...(analyticsMeta?.mode === 'rust_v2_aggregates'
      ? ['Mode: Rust V2 ward analytics aggregates']
      : []),
    '',
    'Occupancy Trends',
  ];

  if (selectedWard === 'all') {
    const firstDay = occupancyData[0] || {};
    lines.push(['Date', ...wards.map((ward) => trendLabelForWard(firstDay, ward)), 'Overall'].map(csvCell).join(','));
  } else {
    const ward = wards.find((item) => item.id === selectedWard);
    const firstDay = occupancyData[0] || {};
    lines.push(['Date', ward ? trendLabelForWard(firstDay, ward) : 'Ward'].map(csvCell).join(','));
  }

  occupancyData.forEach((day) => {
    if (selectedWard === 'all') {
      lines.push([day.date, ...wards.map((ward) => trendValueForWard(day, ward)), day.Overall || 0].map(csvCell).join(','));
      return;
    }

    const ward = wards.find((item) => item.id === selectedWard);
    lines.push([day.date, ward ? trendValueForWard(day, ward) : 0].map(csvCell).join(','));
  });

  lines.push(
    '',
    'Ward Utilization',
    ['Ward', 'Occupancy Rate (%)', 'Occupied Beds', 'Total Beds', 'Turnover Rate', 'Avg LOS (days)', 'Bed Days'].map(csvCell).join(',')
  );
  utilizationData.forEach((ward) => {
    lines.push([
      ward.ward,
      csvMetric(ward.occupancy_rate),
      csvMetric(ward.occupied_beds_count),
      csvMetric(ward.total_beds),
      csvMetric(ward.turnover_rate, isUnavailableMetric(analyticsMeta, 'turnover_rate')),
      csvMetric(ward.avg_los, isUnavailableMetric(analyticsMeta, 'avg_los') || isUnavailableMetric(analyticsMeta, 'length_of_stay')),
      csvMetric(ward.bed_days, isUnavailableMetric(analyticsMeta, 'bed_days') || isUnavailableMetric(analyticsMeta, 'length_of_stay')),
    ].map(csvCell).join(','));
  });

  lines.push(
    '',
    'Admissions, Discharges, and Transfers',
    ['Ward', 'Admissions', 'Discharges', 'Transfers'].map(csvCell).join(',')
  );
  admissionsByWard.forEach((ward) => {
    lines.push([
      ward.ward,
      ward.admissions,
      ward.discharges,
      csvMetric(ward.transfers, isUnavailableMetric(analyticsMeta, 'transfers')),
    ].map(csvCell).join(','));
  });

  return lines.join('\n');
}

function useWardOccupancyReport(selectedWard, dateRange) {
  const [state, dispatch] = useReducer(reportReducer, initialReportState);

  useEffect(() => {
    let cancelled = false;

    async function fetchWards() {
      dispatch({ type: 'wards-loading' });
      try {
        const wardsResponse = await wardsApi.getWards();
        if (cancelled) return;

        const wards = Array.isArray(wardsResponse) ? wardsResponse : wardsResponse.results || [];
        dispatch({ type: 'wards-loaded', wards });
      } catch (err) {
        console.error('Error fetching wards:', err);
        if (!cancelled) {
          dispatch({ type: 'failed', message: 'Failed to load wards data. Please try again.' });
        }
      }
    }

    fetchWards();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.wards.length === 0) {
      return undefined;
    }

    let cancelled = false;

    async function fetchAnalytics() {
      dispatch({ type: 'analytics-loading' });
      try {
        const analyticsData = await wardsApi.getAnalytics({
          ward_id: selectedWard,
          start_date: format(dateRange.start, 'yyyy-MM-dd'),
          end_date: format(dateRange.end, 'yyyy-MM-dd'),
        });
        if (!cancelled) {
          dispatch({ type: 'analytics-loaded', analytics: normalizeAnalytics(analyticsData) });
        }
      } catch (err) {
        console.error('Error fetching analytics:', err);
        if (!cancelled) {
          dispatch({ type: 'failed', message: 'Failed to load analytics data. Please try again.' });
        }
      }
    }

    fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, [dateRange, selectedWard, state.wards]);

  return state;
}

function ReportError({ message }) {
  return (
    <Card className="m-4">
      <CardHeader>
        <CardTitle className="text-red-500">Error</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{message}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
}

function ReportLoading() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function ReportToolbar({
  analyticsMeta,
  dateRange,
  onDateChange,
  onExport,
  onWardChange,
  selectedWard,
  wards,
}) {
  return (
    <section
      aria-label="Report controls"
      className="rounded-lg border border-border bg-card/80 px-3 py-3 shadow-sm sm:px-4"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-wrap items-center gap-2 xl:min-h-9">
          <ReportModeBadge analyticsMeta={analyticsMeta} />
          <span className="font-mono text-xs text-muted-foreground">
            {dateRange.start && dateRange.end
              ? `${format(dateRange.start, 'MMM d, yyyy')} - ${format(dateRange.end, 'MMM d, yyyy')}`
              : 'Select a report range'}
          </span>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-end">
          <div className="space-y-1.5 lg:w-44">
            <Label htmlFor="ward-report-ward" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Ward</Label>
            <Select value={selectedWard} onValueChange={onWardChange}>
              <SelectTrigger id="ward-report-ward" className="h-9 w-full">
                <SelectValue placeholder="Select ward" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Wards</SelectItem>
                {wards.map((ward) => (
                  <SelectItem key={ward.id} value={ward.id}>
                    {ward.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 lg:w-48">
            <Label htmlFor="ward-report-start" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Start</Label>
            <DatePicker
              id="ward-report-start"
              date={dateRange.start}
              setDate={(date) => onDateChange('start', date)}
              placeholder="Start date"
              className="h-9 font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5 lg:w-48">
            <Label htmlFor="ward-report-end" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">End</Label>
            <DatePicker
              id="ward-report-end"
              date={dateRange.end}
              setDate={(date) => onDateChange('end', date)}
              placeholder="End date"
              className="h-9 font-mono text-sm"
            />
          </div>

          <Button onClick={onExport} variant="outline" className="h-9 font-mono text-xs lg:mb-0">
            <Download className="mr-2 size-4" />
            Export Report
          </Button>
        </div>
      </div>
    </section>
  );
}

function ChartTab({ children, value }) {
  return (
    <TabsContent value={value} className="mt-5">
      <DeferredMount placeholder={<Skeleton className="h-[300px] w-full" />}>
        <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
          {children}
        </Suspense>
      </DeferredMount>
    </TabsContent>
  );
}

function ReportTabs({
  admissionsByWard,
  analyticsMeta,
  lengthOfStayData,
  occupancyData,
  selectedWard,
  utilizationData,
  wards,
}) {
  const [activeTab, setActiveTab] = useUrlEnumParam({
    param: 'tab',
    values: WARD_REPORT_TABS,
    defaultValue: 'occupancy',
  });

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
      <TabsList className="h-auto max-w-full flex-wrap gap-1 rounded-lg bg-muted/50 p-1">
        <TabsTrigger value="occupancy" className="font-mono text-xs">
          <TrendingUp className="mr-2 size-4" />
          Occupancy Trends
        </TabsTrigger>
        <TabsTrigger value="los" className="font-mono text-xs">
          <Clock className="mr-2 size-4" />
          Length of Stay
        </TabsTrigger>
        <TabsTrigger value="utilization" className="font-mono text-xs">
          <Bed className="mr-2 size-4" />
          Ward Utilization
        </TabsTrigger>
        <TabsTrigger value="admissions" className="font-mono text-xs">
          <Users className="mr-2 size-4" />
          Admissions
        </TabsTrigger>
      </TabsList>

      <ChartTab value="occupancy">
        <OccupancyTrendsPanel
          occupancyData={occupancyData}
          analyticsMeta={analyticsMeta}
          utilizationData={utilizationData}
          wards={wards}
          selectedWard={selectedWard}
        />
      </ChartTab>
      <ChartTab value="los">
        <LengthOfStayPanel
          analyticsMeta={analyticsMeta}
          lengthOfStayData={lengthOfStayData}
          utilizationData={utilizationData}
        />
      </ChartTab>
      <ChartTab value="utilization">
        <UtilizationPanel analyticsMeta={analyticsMeta} utilizationData={utilizationData} />
      </ChartTab>
      <ChartTab value="admissions">
        <AdmissionsPanel admissionsByWard={admissionsByWard} analyticsMeta={analyticsMeta} wards={wards} />
      </ChartTab>
    </Tabs>
  );
}

export function WardOccupancyReports() {
  const [selectedWard, setSelectedWard] = useState('all');
  const [dateRange, setDateRange] = useState({
    start: subDays(new Date(), 30),
    end: new Date(),
  });
  const {
    admissionsByWard,
    analyticsMeta,
    analyticsLoading,
    error,
    lengthOfStayData,
    occupancyData,
    utilizationData,
    wards,
    wardsLoading,
  } = useWardOccupancyReport(selectedWard, dateRange);

  const handleDateChange = (field, date) => {
    setDateRange((prev) => ({ ...prev, [field]: date }));
  };

  const exportReport = () => {
    try {
      const csvContent = buildWardOccupancyCsv({
        admissionsByWard,
        analyticsMeta,
        dateRange,
        occupancyData,
        selectedWard,
        utilizationData,
        wards,
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `ward_occupancy_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting report:', err);
      alert('Failed to export report. Please try again.');
    }
  };

  if (wardsLoading) {
    return <ReportLoading />;
  }

  if (error) {
    return <ReportError message={error} />;
  }

  return (
    <div className="space-y-6">
      <ReportToolbar
        analyticsMeta={analyticsMeta}
        dateRange={dateRange}
        onDateChange={handleDateChange}
        onExport={exportReport}
        onWardChange={setSelectedWard}
        selectedWard={selectedWard}
        wards={wards}
      />

      {analyticsLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : (
        <ReportTabs
          admissionsByWard={admissionsByWard}
          analyticsMeta={analyticsMeta}
          lengthOfStayData={lengthOfStayData}
          occupancyData={occupancyData}
          selectedWard={selectedWard}
          utilizationData={utilizationData}
          wards={wards}
        />
      )}
    </div>
  );
}

function ReportModeBadge({ analyticsMeta }) {
  if (analyticsMeta?.mode === 'rust_v2_snapshot') {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 font-mono text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        Snapshot Mode
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="font-mono text-[10px]">
      Analytics Mode
    </Badge>
  );
}
