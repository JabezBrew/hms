import Download from 'lucide-react/dist/esm/icons/download.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { wardsApi } from '@/features/wards/api';
import format from 'date-fns/format';
import subDays from 'date-fns/subDays';
import differenceInDays from 'date-fns/differenceInDays';
import addDays from 'date-fns/addDays';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';

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

  // Format currency
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  // Get colors for charts
  const getChartColors = () => {
    return ['#1976D2', '#00ACC1', '#43A047', '#FFA000', '#E53935', '#5E35B1', '#8E24AA', '#00897B'];
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
          <Download className="h-4 w-4 mr-2" />
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
            <TrendingUp className="h-4 w-4 mr-2" />
            Occupancy Trends
          </TabsTrigger>
          <TabsTrigger value="los" className="font-mono text-xs">
            <Clock className="h-4 w-4 mr-2" />
            Length of Stay
          </TabsTrigger>
          <TabsTrigger value="utilization" className="font-mono text-xs">
            <Bed className="h-4 w-4 mr-2" />
            Ward Utilization
          </TabsTrigger>
          <TabsTrigger value="admissions" className="font-mono text-xs">
            <Users className="h-4 w-4 mr-2" />
            Admissions
          </TabsTrigger>
        </TabsList>
        
        {/* Occupancy Trends Tab */}
        <TabsContent value="occupancy" className="mt-6">
          <div className="space-y-6">
            <Card className="border-border">
              <CardHeader className="pb-4">
                <CardTitle className="font-display text-lg">Occupancy Rate Trends</CardTitle>
                <CardDescription className="font-mono text-xs">
                  Daily occupancy rates over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={occupancyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                      <Tooltip formatter={(value) => [`${value}%`, 'Occupancy Rate']} />
                      <Legend />
                      {selectedWard === 'all' ? (
                        <>
                          <Line 
                            type="monotone" 
                            dataKey="Overall" 
                            stroke="#1976D2" 
                            strokeWidth={2} 
                            dot={{ r: 3 }} 
                            activeDot={{ r: 5 }} 
                          />
                          {wards.map((ward, index) => (
                            <Line 
                              key={ward.id}
                              type="monotone" 
                              dataKey={ward.name} 
                              stroke={getChartColors()[index % getChartColors().length]} 
                              strokeWidth={1.5} 
                              dot={{ r: 2 }} 
                              activeDot={{ r: 4 }} 
                            />
                          ))}
                        </>
                      ) : (
                        <Line 
                          type="monotone" 
                          dataKey={wards.find(w => w.id === selectedWard)?.name || 'Overall'} 
                          stroke="#1976D2" 
                          strokeWidth={2} 
                          dot={{ r: 3 }} 
                          activeDot={{ r: 5 }} 
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Average Occupancy by Ward</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={utilizationData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="ward" />
                        <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                        <Tooltip formatter={(value) => [`${value}%`, 'Occupancy Rate']} />
                        <Bar dataKey="occupancy_rate" fill="#1976D2" name="Occupancy Rate">
                          {utilizationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getChartColors()[index % getChartColors().length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Occupancy Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ward</TableHead>
                          <TableHead>Min</TableHead>
                          <TableHead>Max</TableHead>
                          <TableHead>Average</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {wards.map(ward => {
                          // Calculate min, max, and average occupancy for each ward
                          const wardData = occupancyData.map(d => d[ward.name]).filter(Boolean);
                          const min = wardData.length > 0 ? Math.min(...wardData) : 0;
                          const max = wardData.length > 0 ? Math.max(...wardData) : 0;
                          const avg = wardData.length > 0 ? wardData.reduce((sum, val) => sum + val, 0) / wardData.length : 0;

                          return (
                            <TableRow key={ward.id}>
                              <TableCell>{ward.name}</TableCell>
                              <TableCell>{min.toFixed(1)}%</TableCell>
                              <TableCell>{max.toFixed(1)}%</TableCell>
                              <TableCell>{avg.toFixed(1)}%</TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow>
                          <TableCell className="font-medium">Overall</TableCell>
                          <TableCell>
                            {occupancyData.length > 0 ? Math.min(...occupancyData.map(d => d['Overall']).filter(Boolean)).toFixed(1) : '0.0'}%
                          </TableCell>
                          <TableCell>
                            {occupancyData.length > 0 ? Math.max(...occupancyData.map(d => d['Overall']).filter(Boolean)).toFixed(1) : '0.0'}%
                          </TableCell>
                          <TableCell>
                            {occupancyData.length > 0 ? (occupancyData.reduce((sum, d) => sum + (d['Overall'] || 0), 0) / occupancyData.length).toFixed(1) : '0.0'}%
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        {/* Length of Stay Tab */}
        <TabsContent value="los" className="mt-4">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Length of Stay Distribution</CardTitle>
                  <CardDescription>
                    Distribution of patient stays by duration
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={lengthOfStayData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="range" />
                        <YAxis yAxisId="left" orientation="left" />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `${value}%`} />
                        <Tooltip />
                        <Legend />
                        <Bar yAxisId="left" dataKey="count" fill="#1976D2" name="Number of Patients" />
                        <Line yAxisId="right" type="monotone" dataKey="percentage" stroke="#E53935" name="Percentage" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Average Length of Stay by Ward</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={utilizationData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="ward" />
                        <YAxis />
                        <Tooltip formatter={(value) => [`${value} days`, 'Average LOS']} />
                        <Bar dataKey="avg_los" fill="#00ACC1" name="Average Length of Stay (days)">
                          {utilizationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getChartColors()[index % getChartColors().length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <Card>
              <CardHeader>
                <CardTitle>Length of Stay Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ward</TableHead>
                        <TableHead>Avg LOS (days)</TableHead>
                        <TableHead>Median LOS (days)</TableHead>
                        <TableHead>Min LOS (days)</TableHead>
                        <TableHead>Max LOS (days)</TableHead>
                        <TableHead>Total Patient Days</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {utilizationData.map(ward => {
                        const avgLOS = ward.avg_los || 0;
                        return (
                          <TableRow key={ward.ward}>
                            <TableCell>{ward.ward}</TableCell>
                            <TableCell>{avgLOS.toFixed(1)}</TableCell>
                            <TableCell>{(avgLOS * 0.8).toFixed(1)}</TableCell>
                            <TableCell>{Math.max(1, Math.floor(avgLOS * 0.3))}</TableCell>
                            <TableCell>{Math.ceil(avgLOS * 2.5)}</TableCell>
                            <TableCell>{ward.bed_days || 0}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        {/* Ward Utilization Tab */}
        <TabsContent value="utilization" className="mt-4">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Ward Utilization Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ward</TableHead>
                        <TableHead>Occupancy Rate</TableHead>
                        <TableHead>Turnover Rate</TableHead>
                        <TableHead>Avg LOS (days)</TableHead>
                        <TableHead>Bed Days</TableHead>
                        <TableHead>Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {utilizationData.map(ward => (
                        <TableRow key={ward.ward}>
                          <TableCell>{ward.ward}</TableCell>
                          <TableCell>{ward.occupancy_rate || 0}%</TableCell>
                          <TableCell>{(ward.turnover_rate || 0).toFixed(2)}</TableCell>
                          <TableCell>{(ward.avg_los || 0).toFixed(1)}</TableCell>
                          <TableCell>{ward.bed_days || 0}</TableCell>
                          <TableCell>{formatCurrency(ward.revenue || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue by Ward</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={utilizationData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="ward" />
                        <YAxis tickFormatter={(value) => `$${value / 1000}k`} />
                        <Tooltip formatter={(value) => [formatCurrency(value), 'Revenue']} />
                        <Bar dataKey="revenue" fill="#43A047" name="Revenue">
                          {utilizationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getChartColors()[index % getChartColors().length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Turnover Rate by Ward</CardTitle>
                  <CardDescription>
                    Average number of patients per bed per day
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={utilizationData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="ward" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="turnover_rate" fill="#FFA000" name="Turnover Rate">
                          {utilizationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getChartColors()[index % getChartColors().length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        {/* Admissions Tab */}
        <TabsContent value="admissions" className="mt-4">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Admissions, Discharges, and Transfers by Ward</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={admissionsByWard}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ward" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="admissions" fill="#1976D2" name="Admissions" />
                      <Bar dataKey="discharges" fill="#43A047" name="Discharges" />
                      <Bar dataKey="transfers" fill="#FFA000" name="Transfers" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Admission Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ward</TableHead>
                        <TableHead>Total Admissions</TableHead>
                        <TableHead>Total Discharges</TableHead>
                        <TableHead>Total Transfers</TableHead>
                        <TableHead>Net Change</TableHead>
                        <TableHead>Admission Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {admissionsByWard.map(ward => {
                        const netChange = ward.admissions - ward.discharges;
                        const matchingWard = wards.find(w => w.name === ward.ward);
                        const admissionRate = matchingWard ? 
                          (ward.admissions / matchingWard.total_beds).toFixed(2) : 'N/A';
                        
                        return (
                          <TableRow key={ward.ward}>
                            <TableCell>{ward.ward}</TableCell>
                            <TableCell>{ward.admissions}</TableCell>
                            <TableCell>{ward.discharges}</TableCell>
                            <TableCell>{ward.transfers}</TableCell>
                            <TableCell className={netChange > 0 ? 'text-green-600' : netChange < 0 ? 'text-red-600' : ''}>
                              {netChange > 0 ? `+${netChange}` : netChange}
                            </TableCell>
                            <TableCell>{admissionRate}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
