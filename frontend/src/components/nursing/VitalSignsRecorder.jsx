import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import format from 'date-fns/format';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export function VitalSignsRecorder({ patient }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [vitalSigns, setVitalSigns] = useState([]);
  const [formData, setFormData] = useState({
    temperature: '',
    heart_rate: '',
    respiratory_rate: '',
    blood_pressure_systolic: '',
    blood_pressure_diastolic: '',
    oxygen_saturation: '',
    pain_level: '',
    notes: ''
  });

  // Fetch vital signs history
  useEffect(() => {
    const fetchVitalSigns = async () => {
      try {
        setLoading(true);
        // In a real application, this would fetch from an API endpoint
        // For demo purposes, we'll generate some sample data
        const sampleData = generateSampleVitalSigns(patient.id);
        setVitalSigns(sampleData);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching vital signs:', err);
        setError('Failed to load vital signs history. Please try again.');
        setLoading(false);
      }
    };

    fetchVitalSigns();
  }, [patient.id]);

  // Generate sample vital signs data for demo purposes
  const generateSampleVitalSigns = (patientId) => {
    const now = new Date();
    const data = [];
    
    // Generate data points for the last 24 hours (every 4 hours)
    for (let i = 0; i < 6; i++) {
      const timestamp = new Date(now);
      timestamp.setHours(now.getHours() - (i * 4));
      
      data.push({
        id: `vs-${patientId}-${i}`,
        timestamp: timestamp.toISOString(),
        temperature: (Math.random() * (37.8 - 36.5) + 36.5).toFixed(1),
        heart_rate: Math.floor(Math.random() * (100 - 60) + 60),
        respiratory_rate: Math.floor(Math.random() * (20 - 12) + 12),
        blood_pressure_systolic: Math.floor(Math.random() * (140 - 110) + 110),
        blood_pressure_diastolic: Math.floor(Math.random() * (90 - 70) + 70),
        oxygen_saturation: Math.floor(Math.random() * (100 - 94) + 94),
        pain_level: Math.floor(Math.random() * 6),
        notes: i === 0 ? 'Patient resting comfortably' : ''
      });
    }
    
    return data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      // In a real application, this would send data to an API endpoint
      // For demo purposes, we'll just add it to the local state
      const newVitalSign = {
        id: `vs-${patient.id}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        ...formData
      };
      
      setVitalSigns([newVitalSign, ...vitalSigns]);
      
      // Reset form
      setFormData({
        temperature: '',
        heart_rate: '',
        respiratory_rate: '',
        blood_pressure_systolic: '',
        blood_pressure_diastolic: '',
        oxygen_saturation: '',
        pain_level: '',
        notes: ''
      });
      
      // Show success message (in a real app)
      alert('Vital signs recorded successfully');
    } catch (err) {
      console.error('Error recording vital signs:', err);
      setError('Failed to record vital signs. Please try again.');
    }
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  // Check if a vital sign is abnormal
  const isAbnormal = (name, value) => {
    const ranges = {
      temperature: { min: 36.5, max: 37.5 },
      heart_rate: { min: 60, max: 100 },
      respiratory_rate: { min: 12, max: 20 },
      blood_pressure_systolic: { min: 90, max: 140 },
      blood_pressure_diastolic: { min: 60, max: 90 },
      oxygen_saturation: { min: 95, max: 100 },
    };
    
    if (!ranges[name]) return false;
    
    const numValue = parseFloat(value);
    return numValue < ranges[name].min || numValue > ranges[name].max;
  };

  // Prepare chart data
  const prepareChartData = () => {
    return vitalSigns.map(vs => ({
      time: format(new Date(vs.timestamp), 'HH:mm'),
      temperature: parseFloat(vs.temperature),
      heart_rate: parseInt(vs.heart_rate),
      respiratory_rate: parseInt(vs.respiratory_rate),
      oxygen_saturation: parseInt(vs.oxygen_saturation),
      systolic: parseInt(vs.blood_pressure_systolic),
      diastolic: parseInt(vs.blood_pressure_diastolic),
    })).reverse();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
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
      <Tabs defaultValue="record">
        <TabsList>
          <TabsTrigger value="record">Record Vitals</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>
        
        <TabsContent value="record" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Record Vital Signs</CardTitle>
              <CardDescription>
                Enter the latest vital signs for {patient.user.full_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="temperature">Temperature (°C)</Label>
                    <Input
                      id="temperature"
                      name="temperature"
                      type="number"
                      step="0.1"
                      placeholder="36.5 - 37.5"
                      value={formData.temperature}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="heart_rate">Heart Rate (bpm)</Label>
                    <Input
                      id="heart_rate"
                      name="heart_rate"
                      type="number"
                      placeholder="60 - 100"
                      value={formData.heart_rate}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="respiratory_rate">Respiratory Rate (breaths/min)</Label>
                    <Input
                      id="respiratory_rate"
                      name="respiratory_rate"
                      type="number"
                      placeholder="12 - 20"
                      value={formData.respiratory_rate}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Blood Pressure (mmHg)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="blood_pressure_systolic"
                        name="blood_pressure_systolic"
                        type="number"
                        placeholder="Systolic"
                        value={formData.blood_pressure_systolic}
                        onChange={handleInputChange}
                        required
                      />
                      <span className="flex items-center">/</span>
                      <Input
                        id="blood_pressure_diastolic"
                        name="blood_pressure_diastolic"
                        type="number"
                        placeholder="Diastolic"
                        value={formData.blood_pressure_diastolic}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="oxygen_saturation">Oxygen Saturation (%)</Label>
                    <Input
                      id="oxygen_saturation"
                      name="oxygen_saturation"
                      type="number"
                      placeholder="95 - 100"
                      value={formData.oxygen_saturation}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="pain_level">Pain Level (0-10)</Label>
                    <Input
                      id="pain_level"
                      name="pain_level"
                      type="number"
                      min="0"
                      max="10"
                      placeholder="0 - 10"
                      value={formData.pain_level}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    name="notes"
                    placeholder="Any additional observations"
                    value={formData.notes}
                    onChange={handleInputChange}
                  />
                </div>
                
                <Button type="submit" className="w-full">Record Vital Signs</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Vital Signs History</CardTitle>
              <CardDescription>
                Recent vital signs for {patient.user.full_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Temp (°C)</TableHead>
                      <TableHead>HR (bpm)</TableHead>
                      <TableHead>RR (br/min)</TableHead>
                      <TableHead>BP (mmHg)</TableHead>
                      <TableHead>O₂ Sat (%)</TableHead>
                      <TableHead>Pain (0-10)</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vitalSigns.map(vs => (
                      <TableRow key={vs.id}>
                        <TableCell>{formatTimestamp(vs.timestamp)}</TableCell>
                        <TableCell className={isAbnormal('temperature', vs.temperature) ? 'text-red-600 font-medium' : ''}>
                          {vs.temperature}
                        </TableCell>
                        <TableCell className={isAbnormal('heart_rate', vs.heart_rate) ? 'text-red-600 font-medium' : ''}>
                          {vs.heart_rate}
                        </TableCell>
                        <TableCell className={isAbnormal('respiratory_rate', vs.respiratory_rate) ? 'text-red-600 font-medium' : ''}>
                          {vs.respiratory_rate}
                        </TableCell>
                        <TableCell className={
                          isAbnormal('blood_pressure_systolic', vs.blood_pressure_systolic) || 
                          isAbnormal('blood_pressure_diastolic', vs.blood_pressure_diastolic) 
                            ? 'text-red-600 font-medium' 
                            : ''
                        }>
                          {vs.blood_pressure_systolic}/{vs.blood_pressure_diastolic}
                        </TableCell>
                        <TableCell className={isAbnormal('oxygen_saturation', vs.oxygen_saturation) ? 'text-red-600 font-medium' : ''}>
                          {vs.oxygen_saturation}
                        </TableCell>
                        <TableCell>
                          {vs.pain_level}
                        </TableCell>
                        <TableCell>
                          {vs.notes}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="trends" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Vital Signs Trends</CardTitle>
              <CardDescription>
                Visualize trends in vital signs for {patient.user.full_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-medium mb-2">Temperature (°C)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={prepareChartData()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis domain={[36, 38]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="temperature" stroke="#8884d8" activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-2">Heart Rate (bpm)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={prepareChartData()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis domain={[50, 120]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="heart_rate" stroke="#82ca9d" activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-2">Blood Pressure (mmHg)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={prepareChartData()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis domain={[40, 160]} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="systolic" stroke="#ff7300" activeDot={{ r: 8 }} />
                      <Line type="monotone" dataKey="diastolic" stroke="#387908" activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-2">Oxygen Saturation (%)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={prepareChartData()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis domain={[90, 100]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="oxygen_saturation" stroke="#0088FE" activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
