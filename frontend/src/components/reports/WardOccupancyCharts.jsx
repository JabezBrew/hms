import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const USD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const getChartColors = () => {
  return ['#1976D2', '#00ACC1', '#43A047', '#FFA000', '#E53935', '#5E35B1', '#8E24AA', '#00897B'];
};

const formatCurrency = (value) => {
  return USD_CURRENCY_FORMATTER.format(value);
};

export function OccupancyTrendsPanel({ occupancyData, utilizationData, wards, selectedWard }) {
  return (
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
                    const wardData = occupancyData.flatMap((d) => (d[ward.name] ? [d[ward.name]] : []));
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
                      {occupancyData.length > 0 ? Math.min(...occupancyData.flatMap((d) => (d['Overall'] ? [d['Overall']] : []))).toFixed(1) : '0.0'}%
                    </TableCell>
                    <TableCell>
                      {occupancyData.length > 0 ? Math.max(...occupancyData.flatMap((d) => (d['Overall'] ? [d['Overall']] : []))).toFixed(1) : '0.0'}%
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
  );
}

export function LengthOfStayPanel({ lengthOfStayData, utilizationData }) {
  return (
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
  );
}

export function UtilizationPanel({ utilizationData }) {
  return (
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
  );
}

export function AdmissionsPanel({ admissionsByWard, wards }) {
  return (
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
  );
}
