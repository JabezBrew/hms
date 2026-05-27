/* oxlint-disable react-doctor/prefer-useReducer -- Report loading uses a reducer below because ward and analytics state transition together. */
import Download from 'lucide-react/dist/esm/icons/download.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import { lazy, Suspense, useEffect, useReducer, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { wardsApi } from '@/features/wards/api';
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
  occupancyData: [],
  lengthOfStayData: [],
  utilizationData: [],
  admissionsByWard: [],
};

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

function buildWardOccupancyCsv({
  admissionsByWard,
  dateRange,
  occupancyData,
  selectedWard,
  utilizationData,
  wards,
}) {
  const lines = [
    'Ward Occupancy Report',
    `Date Range: ${format(dateRange.start, 'MMM dd, yyyy')} - ${format(dateRange.end, 'MMM dd, yyyy')}`,
    '',
    'Occupancy Trends',
  ];

  if (selectedWard === 'all') {
    lines.push(['Date', ...wards.map((ward) => ward.name), 'Overall'].map(csvCell).join(','));
  } else {
    const ward = wards.find((item) => item.id === selectedWard);
    lines.push(['Date', ward?.name || 'Ward'].map(csvCell).join(','));
  }

  occupancyData.forEach((day) => {
    if (selectedWard === 'all') {
      lines.push([day.date, ...wards.map((ward) => day[ward.name] || 0), day.Overall || 0].map(csvCell).join(','));
      return;
    }

    const ward = wards.find((item) => item.id === selectedWard);
    lines.push([day.date, day[ward?.name] || 0].map(csvCell).join(','));
  });

  lines.push(
    '',
    'Ward Utilization',
    ['Ward', 'Occupancy Rate (%)', 'Turnover Rate', 'Avg LOS (days)', 'Bed Days', 'Revenue'].map(csvCell).join(',')
  );
  utilizationData.forEach((ward) => {
    lines.push([
      ward.ward,
      ward.occupancy_rate || 0,
      ward.turnover_rate || 0,
      ward.avg_los || 0,
      ward.bed_days || 0,
      ward.revenue || 0,
    ].map(csvCell).join(','));
  });

  lines.push(
    '',
    'Admissions, Discharges, and Transfers',
    ['Ward', 'Admissions', 'Discharges', 'Transfers'].map(csvCell).join(',')
  );
  admissionsByWard.forEach((ward) => {
    lines.push([ward.ward, ward.admissions, ward.discharges, ward.transfers].map(csvCell).join(','));
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
          start_date: dateRange.start.toISOString(),
          end_date: dateRange.end.toISOString(),
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

function ReportFilters({ dateRange, onDateChange, onWardChange, selectedWard, wards }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-4">
        <CardTitle className="font-display text-lg">Report Filters</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="ward" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Ward</Label>
            <Select value={selectedWard} onValueChange={onWardChange}>
              <SelectTrigger id="ward">
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

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Start Date</Label>
            <DatePicker
              date={dateRange.start}
              setDate={(date) => onDateChange('start', date)}
              placeholder="Start date"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">End Date</Label>
            <DatePicker
              date={dateRange.end}
              setDate={(date) => onDateChange('end', date)}
              placeholder="End date"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTab({ children, value }) {
  return (
    <TabsContent value={value} className="mt-4 data-[state=active]:mt-6">
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
  lengthOfStayData,
  occupancyData,
  selectedWard,
  utilizationData,
  wards,
}) {
  return (
    <Tabs defaultValue="occupancy">
      <TabsList className="bg-muted/50">
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
          utilizationData={utilizationData}
          wards={wards}
          selectedWard={selectedWard}
        />
      </ChartTab>
      <ChartTab value="los">
        <LengthOfStayPanel
          lengthOfStayData={lengthOfStayData}
          utilizationData={utilizationData}
        />
      </ChartTab>
      <ChartTab value="utilization">
        <UtilizationPanel utilizationData={utilizationData} />
      </ChartTab>
      <ChartTab value="admissions">
        <AdmissionsPanel admissionsByWard={admissionsByWard} wards={wards} />
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
      <div className="flex justify-end">
        <Button onClick={exportReport} variant="outline" className="font-mono text-xs">
          <Download className="mr-2 size-4" />
          Export Report
        </Button>
      </div>

      <ReportFilters
        dateRange={dateRange}
        onDateChange={handleDateChange}
        onWardChange={setSelectedWard}
        selectedWard={selectedWard}
        wards={wards}
      />

      {analyticsLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : (
        <ReportTabs
          admissionsByWard={admissionsByWard}
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
