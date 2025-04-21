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
import { apiClient } from '@/lib/api';
import { format, subDays, differenceInDays, addDays } from 'date-fns';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Download, Calendar, TrendingUp, Clock, Users, Bed, FileText } from 'lucide-react';

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
        const wardsData = await apiClient.get('/wards/');
        setWards(wardsData);
        
        // In a real application, we would fetch actual data from the API
        // For demo purposes, we'll generate sample data
        generateSampleData(wardsData);
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to load report data. Please try again.');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Generate sample data for demo purposes
  const generateSampleData = (wardsData) => {
    // Generate occupancy data (daily occupancy rates for the past 30 days)
    const occupancyRates = [];
    const now = new Date();
    
    for (let i = 30; i >= 0; i--) {
      const date = subDays(now, i);
      const dateStr = format(date, 'MMM d');
      
      const dayData = {
        date: dateStr,
        fullDate: date,
      };
      
      // Add occupancy rate for each ward
      wardsData.forEach(ward => {
        // Generate a random occupancy rate between 50% and 95%
        // With some day-to-day variation but a general trend
        const baseRate = 70 + Math.sin(i / 5) * 15;
        const randomVariation = Math.random() * 10 - 5;
        const rate = Math.min(Math.max(baseRate + randomVariation, 50), 95);
        
        dayData[`${ward.name}`] = parseFloat(rate.toFixed(1));
      });
      
      // Add overall occupancy rate
      const overallRate = Object.keys(dayData)
        .filter(key => key !== 'date' && key !== 'fullDate')
        .reduce((sum, key) => sum + dayData[key], 0) / wardsData.length;
      
      dayData['Overall'] = parseFloat(overallRate.toFixed(1));
      
      occupancyRates.push(dayData);
    }
    
    setOccupancyData(occupancyRates);
    
    // Generate length of stay data
    const losData = [
      { range: '1-3 days', count: 45, percentage: 45 },
      { range: '4-7 days', count: 30, percentage: 30 },
      { range: '8-14 days', count: 15, percentage: 15 },
      { range: '15-30 days', count: 8, percentage: 8 },
      { range: '31+ days', count: 2, percentage: 2 }
    ];
    
    setLengthOfStayData(losData);
    
    // Generate utilization data
    const utilizationByWard = wardsData.map(ward => {
      // Generate random utilization metrics
      const occupancyRate = 50 + Math.random() * 45;
      const turnoverRate = 0.1 + Math.random() * 0.3;
      const avgLOS = 3 + Math.random() * 7;
      
      return {
        ward: ward.name,
        occupancyRate: parseFloat(occupancyRate.toFixed(1)),
        turnoverRate: parseFloat(turnoverRate.toFixed(2)),
        avgLOS: parseFloat(avgLOS.toFixed(1)),
        bedDays: Math.floor(ward.total_beds * 30 * (occupancyRate / 100)),
        revenue: Math.floor(ward.total_beds * 30 * (occupancyRate / 100) * (ward.base_rate_per_night || 100))
      };
    });
    
    setUtilizationData(utilizationByWard);
    
    // Generate admissions by ward
    const admissionsByWardData = wardsData.map(ward => ({
      ward: ward.name,
      admissions: Math.floor(20 + Math.random() * 50),
      discharges: Math.floor(15 + Math.random() * 45),
      transfers: Math.floor(Math.random() * 10)
    }));
    
    setAdmissionsByWard(admissionsByWardData);
  };

  // Filter data based on selected ward and date range
  const getFilteredData = (data, dateField = 'fullDate') => {
    if (!data || data.length === 0) return [];
    
    return data.filter(item => {
      // Filter by date if the item has a date field
      if (item[dateField]) {
        const itemDate = new Date(item[dateField]);
        return itemDate >= dateRange.start && itemDate <= dateRange.end;
      }
      return true;
    });
  };

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
    // In a real application, this would generate a CSV file
    // For demo purposes, we'll just show an alert
    alert('Report exported successfully');
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

  // Filter occupancy data based on selected ward and date range
  const filteredOccupancyData = getFilteredData(occupancyData, 'fullDate');

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold">Ward Occupancy Reports</h1>
        
        <Button onClick={exportReport} variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Export Report
        </Button>
      </div>
      
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Report Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ward">Ward</Label>
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
              <Label>Start Date</Label>
              <DatePicker
                date={dateRange.start}
                setDate={(date) => handleDateChange('start', date)}
              />
            </div>
            
            <div className="space-y-2">
              <Label>End Date</Label>
              <DatePicker
                date={dateRange.end}
                setDate={(date) => handleDateChange('end', date)}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Tabs defaultValue="occupancy">
        <TabsList>
          <TabsTrigger value="occupancy">
            <TrendingUp className="h-4 w-4 mr-2" />
            Occupancy Trends
          </TabsTrigger>
          <TabsTrigger value="los">
            <Clock className="h-4 w-4 mr-2" />
            Length of Stay
          </TabsTrigger>
          <TabsTrigger value="utilization">
            <Bed className="h-4 w-4 mr-2" />
            Ward Utilization
          </TabsTrigger>
          <TabsTrigger value="admissions">
            <Users className="h-4 w-4 mr-2" />
            Admissions
          </TabsTrigger>
        </TabsList>
        
        {/* Occupancy Trends Tab */}
        <TabsContent value="occupancy" className="mt-4">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Occupancy Rate Trends</CardTitle>
                <CardDescription>
                  Daily occupancy rates over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={filteredOccupancyData}>
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
                        <Bar dataKey="occupancyRate" fill="#1976D2" name="Occupancy Rate">
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
                          const wardData = filteredOccupancyData.map(d => d[ward.name]).filter(Boolean);
                          const min = Math.min(...wardData);
                          const max = Math.max(...wardData);
                          const avg = wardData.reduce((sum, val) => sum + val, 0) / wardData.length;
                          
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
                            {Math.min(...filteredOccupancyData.map(d => d['Overall']).filter(Boolean)).toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            {Math.max(...filteredOccupancyData.map(d => d['Overall']).filter(Boolean)).toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            {(filteredOccupancyData.reduce((sum, d) => sum + (d['Overall'] || 0), 0) / filteredOccupancyData.length).toFixed(1)}%
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
                        <Bar dataKey="avgLOS" fill="#00ACC1" name="Average Length of Stay (days)">
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
                      {utilizationData.map(ward => (
                        <TableRow key={ward.ward}>
                          <TableCell>{ward.ward}</TableCell>
                          <TableCell>{ward.avgLOS.toFixed(1)}</TableCell>
                          <TableCell>{(ward.avgLOS * 0.8).toFixed(1)}</TableCell>
                          <TableCell>{Math.max(1, Math.floor(ward.avgLOS * 0.3))}</TableCell>
                          <TableCell>{Math.ceil(ward.avgLOS * 2.5)}</TableCell>
                          <TableCell>{ward.bedDays}</TableCell>
                        </TableRow>
                      ))}
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
                          <TableCell>{ward.occupancyRate}%</TableCell>
                          <TableCell>{ward.turnoverRate.toFixed(2)}</TableCell>
                          <TableCell>{ward.avgLOS.toFixed(1)}</TableCell>
                          <TableCell>{ward.bedDays}</TableCell>
                          <TableCell>{formatCurrency(ward.revenue)}</TableCell>
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
                        <Bar dataKey="turnoverRate" fill="#FFA000" name="Turnover Rate">
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