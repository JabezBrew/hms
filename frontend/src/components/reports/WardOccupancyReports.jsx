import Download from 'lucide-react/dist/esm/icons/download.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function WardOccupancyReports() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wards, setWards] = useState([]);
  const [selectedWard, setSelectedWard] = useState('all');
  const [dateRange, setDateRange] = useState({
    start: subDays(new Date(), 30),
    end: new Date()
  });
  const [occupancyData, setOccupancyData] = useState([]);
  const [lengthOfStayData, setLengthOfStayData] = useState([]);
  const [utilizationData, setUtilizationData] = useState([]);
  const [admissionsByWard, setAdmissionsByWard] = useState([]);

  // Fetch wards and report data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch wards
        const wardsResponse = await wardsApi.getWards();
        const wardsData = Array.isArray(wardsResponse) ? wardsResponse : wardsResponse.results || [];
        setWards(wardsData);

        setLoading(false);
      } catch (err) {
        console.error('Error fetching wards:', err);
        setError('Failed to load wards data. Please try again.');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Fetch analytics data whenever filters change
  useEffect(() => {
    const fetchAnalytics = async () => {
      if (wards.length === 0) return;

      try {
        setLoading(true);

        // Build query parameters
        const params = {
          ward_id: selectedWard,
          start_date: dateRange.start.toISOString(),
          end_date: dateRange.end.toISOString()
        };

        // Fetch analytics data from API
        const analyticsData = await wardsApi.getAnalytics(params);

        // Update state with real data
        setOccupancyData(analyticsData.occupancy_trends || []);
        setLengthOfStayData(analyticsData.length_of_stay || []);
        setUtilizationData(analyticsData.ward_utilization || []);
        setAdmissionsByWard(analyticsData.admissions_by_ward || []);

        setLoading(false);
      } catch (err) {
        console.error('Error fetching analytics:', err);
        setError('Failed to load analytics data. Please try again.');
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [wards, selectedWard, dateRange]);

  // Handle ward selection change
  const handleWardChange = (value) => {
    setSelectedWard(value);
  };

  // Handle date range change
  const handleDateChange = (field, date) => {
    setDateRange(prev => ({ ...prev, [field]: date }));
  };

  // Export report as CSV
  const exportReport = () => {
    try {
      // Prepare CSV content
      let csvContent = 'Ward Occupancy Report\n';
      csvContent += `Date Range: ${format(dateRange.start, 'MMM dd, yyyy')} - ${format(dateRange.end, 'MMM dd, yyyy')}\n\n`;

      // Add occupancy trends section
      csvContent += 'Occupancy Trends\n';
      csvContent += 'Date,';
      if (selectedWard === 'all') {
        wards.forEach(ward => {
          csvContent += `${ward.name},`;
        });
        csvContent += 'Overall\n';
      } else {
        const ward = wards.find(w => w.id === selectedWard);
        csvContent += `${ward?.name || 'Ward'}\n`;
      }

      occupancyData.forEach(day => {
        csvContent += `${day.date},`;
        if (selectedWard === 'all') {
          wards.forEach(ward => {
            csvContent += `${day[ward.name] || 0},`;
          });
          csvContent += `${day.Overall || 0}\n`;
        } else {
          const ward = wards.find(w => w.id === selectedWard);
          csvContent += `${day[ward?.name] || 0}\n`;
        }
      });

      csvContent += '\n';

      // Add utilization metrics section
      csvContent += 'Ward Utilization\n';
      csvContent += 'Ward,Occupancy Rate (%),Turnover Rate,Avg LOS (days),Bed Days,Revenue\n';
      utilizationData.forEach(ward => {
        csvContent += `${ward.ward},${ward.occupancy_rate || 0},${ward.turnover_rate || 0},${ward.avg_los || 0},${ward.bed_days || 0},${ward.revenue || 0}\n`;
      });

      csvContent += '\n';

      // Add admissions section
      csvContent += 'Admissions, Discharges, and Transfers\n';
      csvContent += 'Ward,Admissions,Discharges,Transfers\n';
      admissionsByWard.forEach(ward => {
        csvContent += `${ward.ward},${ward.admissions},${ward.discharges},${ward.transfers}\n`;
      });

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `ward_occupancy_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error exporting report:', err);
      alert('Failed to export report. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="m-4">
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error}</p>
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

  return (
    <div className="space-y-6">
      {/* Export Button */}
      <div className="flex justify-end">
        <Button onClick={exportReport} variant="outline" className="font-mono text-xs">
          <Download className="size-4 mr-2" />
          Export Report
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-border">
        <CardHeader className="pb-4">
          <CardTitle className="font-display text-lg">Report Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="ward" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Ward</Label>
              <Select
                value={selectedWard}
                onValueChange={handleWardChange}
              >
                <SelectTrigger id="ward">
                  <SelectValue placeholder="Select ward" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Wards</SelectItem>
                  {wards.map(ward => (
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
                setDate={(date) => handleDateChange('start', date)}
                placeholder="Start date"
                className="font-mono text-sm"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">End Date</Label>
              <DatePicker
                date={dateRange.end}
                setDate={(date) => handleDateChange('end', date)}
                placeholder="End date"
                className="font-mono text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Tabs defaultValue="occupancy">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="occupancy" className="font-mono text-xs">
            <TrendingUp className="size-4 mr-2" />
            Occupancy Trends
          </TabsTrigger>
          <TabsTrigger value="los" className="font-mono text-xs">
            <Clock className="size-4 mr-2" />
            Length of Stay
          </TabsTrigger>
          <TabsTrigger value="utilization" className="font-mono text-xs">
            <Bed className="size-4 mr-2" />
            Ward Utilization
          </TabsTrigger>
          <TabsTrigger value="admissions" className="font-mono text-xs">
            <Users className="size-4 mr-2" />
            Admissions
          </TabsTrigger>
        </TabsList>
        
        {/* Occupancy Trends Tab */}
        <TabsContent value="occupancy" className="mt-6">
          <DeferredMount placeholder={<Skeleton className="h-[300px] w-full" />}>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <OccupancyTrendsPanel
                occupancyData={occupancyData}
                utilizationData={utilizationData}
                wards={wards}
                selectedWard={selectedWard}
              />
            </Suspense>
          </DeferredMount>
        </TabsContent>
        
        {/* Length of Stay Tab */}
        <TabsContent value="los" className="mt-4">
          <DeferredMount placeholder={<Skeleton className="h-[300px] w-full" />}>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <LengthOfStayPanel
                lengthOfStayData={lengthOfStayData}
                utilizationData={utilizationData}
              />
            </Suspense>
          </DeferredMount>
        </TabsContent>
        
        {/* Ward Utilization Tab */}
        <TabsContent value="utilization" className="mt-4">
          <DeferredMount placeholder={<Skeleton className="h-[300px] w-full" />}>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <UtilizationPanel utilizationData={utilizationData} />
            </Suspense>
          </DeferredMount>
        </TabsContent>
        
        {/* Admissions Tab */}
        <TabsContent value="admissions" className="mt-4">
          <DeferredMount placeholder={<Skeleton className="h-[300px] w-full" />}>
            <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
              <AdmissionsPanel admissionsByWard={admissionsByWard} wards={wards} />
            </Suspense>
          </DeferredMount>
        </TabsContent>
      </Tabs>
    </div>
  );
}
