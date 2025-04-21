import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient } from '@/lib/api';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, ReferenceLine } from 'recharts';
import { Droplet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

export function FluidBalanceTracker({ patient }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fluidRecords, setFluidRecords] = useState([]);
  const [dailySummaries, setDailySummaries] = useState([]);
  const [formData, setFormData] = useState({
    type: 'intake',
    category: '',
    amount: '',
    route: '',
    notes: ''
  });

  // Fetch fluid balance records
  useEffect(() => {
    const fetchFluidRecords = async () => {
      try {
        setLoading(true);
        // In a real application, this would fetch from an API endpoint
        // For demo purposes, we'll generate some sample data
        const sampleData = generateSampleFluidRecords(patient.id);
        setFluidRecords(sampleData);
        
        // Generate daily summaries
        const summaries = generateDailySummaries(sampleData);
        setDailySummaries(summaries);
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching fluid records:', err);
        setError('Failed to load fluid balance records. Please try again.');
        setLoading(false);
      }
    };

    fetchFluidRecords();
  }, [patient.id]);

  // Generate sample fluid records for demo purposes
  const generateSampleFluidRecords = (patientId) => {
    const now = new Date();
    const records = [];
    
    // Generate data for the last 3 days
    for (let day = 0; day < 3; day++) {
      const date = new Date(now);
      date.setDate(date.getDate() - day);
      
      // Generate intake records
      const intakeCategories = ['Oral', 'IV Fluids', 'Enteral Feed', 'Blood Products'];
      const intakeRoutes = {
        'Oral': ['Water', 'Juice', 'Tea', 'Coffee', 'Milk'],
        'IV Fluids': ['Normal Saline', 'Lactated Ringers', 'D5W'],
        'Enteral Feed': ['Nasogastric', 'PEG Tube'],
        'Blood Products': ['Packed RBCs', 'Platelets', 'Plasma']
      };
      
      // Generate 4-6 intake records per day
      const intakeCount = Math.floor(Math.random() * 3) + 4;
      for (let i = 0; i < intakeCount; i++) {
        const hour = Math.floor(Math.random() * 24);
        const timestamp = new Date(date);
        timestamp.setHours(hour, Math.floor(Math.random() * 60));
        
        const category = intakeCategories[Math.floor(Math.random() * intakeCategories.length)];
        const routes = intakeRoutes[category];
        const route = routes[Math.floor(Math.random() * routes.length)];
        
        records.push({
          id: `fluid-${patientId}-intake-${day}-${i}`,
          type: 'intake',
          category: category,
          route: route,
          amount: Math.floor(Math.random() * 300) + 50, // 50-350 ml
          timestamp: timestamp.toISOString(),
          notes: '',
          recorded_by: 'Nurse Johnson'
        });
      }
      
      // Generate output records
      const outputCategories = ['Urine', 'Vomit', 'Stool', 'Drain', 'Other'];
      
      // Generate 3-5 output records per day
      const outputCount = Math.floor(Math.random() * 3) + 3;
      for (let i = 0; i < outputCount; i++) {
        const hour = Math.floor(Math.random() * 24);
        const timestamp = new Date(date);
        timestamp.setHours(hour, Math.floor(Math.random() * 60));
        
        const category = outputCategories[Math.floor(Math.random() * outputCategories.length)];
        
        records.push({
          id: `fluid-${patientId}-output-${day}-${i}`,
          type: 'output',
          category: category,
          route: category === 'Drain' ? ['Chest Tube', 'Surgical Drain', 'Nasogastric Tube'][Math.floor(Math.random() * 3)] : '',
          amount: Math.floor(Math.random() * 400) + 100, // 100-500 ml
          timestamp: timestamp.toISOString(),
          notes: '',
          recorded_by: 'Nurse Johnson'
        });
      }
    }
    
    return records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  // Generate daily summaries from fluid records
  const generateDailySummaries = (records) => {
    const summaries = {};
    
    records.forEach(record => {
      const date = format(new Date(record.timestamp), 'yyyy-MM-dd');
      
      if (!summaries[date]) {
        summaries[date] = {
          date,
          intake: 0,
          output: 0,
          balance: 0
        };
      }
      
      if (record.type === 'intake') {
        summaries[date].intake += record.amount;
      } else {
        summaries[date].output += record.amount;
      }
      
      summaries[date].balance = summaries[date].intake - summaries[date].output;
    });
    
    return Object.values(summaries).sort((a, b) => new Date(b.date) - new Date(a.date));
  };

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle select changes
  const handleSelectChange = (name, value) => {
    if (name === 'type') {
      // Reset category and route when type changes
      setFormData(prev => ({ 
        ...prev, 
        [name]: value,
        category: '',
        route: ''
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  // Get category options based on selected type
  const getCategoryOptions = () => {
    if (formData.type === 'intake') {
      return [
        { label: 'Oral', value: 'Oral' },
        { label: 'IV Fluids', value: 'IV Fluids' },
        { label: 'Enteral Feed', value: 'Enteral Feed' },
        { label: 'Blood Products', value: 'Blood Products' }
      ];
    } else {
      return [
        { label: 'Urine', value: 'Urine' },
        { label: 'Vomit', value: 'Vomit' },
        { label: 'Stool', value: 'Stool' },
        { label: 'Drain', value: 'Drain' },
        { label: 'Other', value: 'Other' }
      ];
    }
  };

  // Get route options based on selected category
  const getRouteOptions = () => {
    if (!formData.category) return [];
    
    const routeMap = {
      'Oral': [
        { label: 'Water', value: 'Water' },
        { label: 'Juice', value: 'Juice' },
        { label: 'Tea', value: 'Tea' },
        { label: 'Coffee', value: 'Coffee' },
        { label: 'Milk', value: 'Milk' },
        { label: 'Other', value: 'Other' }
      ],
      'IV Fluids': [
        { label: 'Normal Saline', value: 'Normal Saline' },
        { label: 'Lactated Ringers', value: 'Lactated Ringers' },
        { label: 'D5W', value: 'D5W' },
        { label: 'Other', value: 'Other' }
      ],
      'Enteral Feed': [
        { label: 'Nasogastric', value: 'Nasogastric' },
        { label: 'PEG Tube', value: 'PEG Tube' },
        { label: 'Other', value: 'Other' }
      ],
      'Blood Products': [
        { label: 'Packed RBCs', value: 'Packed RBCs' },
        { label: 'Platelets', value: 'Platelets' },
        { label: 'Plasma', value: 'Plasma' },
        { label: 'Other', value: 'Other' }
      ],
      'Drain': [
        { label: 'Chest Tube', value: 'Chest Tube' },
        { label: 'Surgical Drain', value: 'Surgical Drain' },
        { label: 'Nasogastric Tube', value: 'Nasogastric Tube' },
        { label: 'Other', value: 'Other' }
      ]
    };
    
    return routeMap[formData.category] || [];
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      // Validate amount
      const amount = parseInt(formData.amount);
      if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
      }
      
      // In a real application, this would send data to an API endpoint
      // For demo purposes, we'll just add it to the local state
      const newRecord = {
        id: `fluid-${patient.id}-${formData.type}-${Date.now()}`,
        type: formData.type,
        category: formData.category,
        route: formData.route,
        amount: amount,
        timestamp: new Date().toISOString(),
        notes: formData.notes,
        recorded_by: 'Current Nurse'
      };
      
      const updatedRecords = [newRecord, ...fluidRecords];
      setFluidRecords(updatedRecords);
      
      // Update daily summaries
      const updatedSummaries = generateDailySummaries(updatedRecords);
      setDailySummaries(updatedSummaries);
      
      // Reset form
      setFormData({
        type: 'intake',
        category: '',
        amount: '',
        route: '',
        notes: ''
      });
      
      // Show success message (in a real app)
      alert('Fluid record added successfully');
    } catch (err) {
      console.error('Error recording fluid balance:', err);
      setError('Failed to record fluid balance. Please try again.');
    }
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  // Format date for display
  const formatDate = (dateString) => {
    return format(new Date(dateString), 'MMM d, yyyy');
  };

  // Get today's records
  const getTodayRecords = () => {
    const today = new Date();
    const startOfToday = startOfDay(today);
    const endOfToday = endOfDay(today);
    
    return fluidRecords.filter(record => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= startOfToday && recordDate <= endOfToday;
    });
  };

  // Calculate today's totals
  const calculateTodayTotals = () => {
    const todayRecords = getTodayRecords();
    
    const intake = todayRecords
      .filter(record => record.type === 'intake')
      .reduce((sum, record) => sum + record.amount, 0);
      
    const output = todayRecords
      .filter(record => record.type === 'output')
      .reduce((sum, record) => sum + record.amount, 0);
      
    const balance = intake - output;
    
    return { intake, output, balance };
  };

  // Prepare chart data
  const prepareChartData = () => {
    return dailySummaries.map(summary => ({
      date: format(new Date(summary.date), 'MMM d'),
      intake: summary.intake,
      output: summary.output,
      balance: summary.balance
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

  const todayTotals = calculateTodayTotals();

  return (
    <div className="space-y-6">
      <Tabs defaultValue="record">
        <TabsList>
          <TabsTrigger value="record">Record Fluid</TabsTrigger>
          <TabsTrigger value="today">Today's Balance</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>
        
        <TabsContent value="record" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Record Fluid Balance</CardTitle>
              <CardDescription>
                Enter fluid intake or output for {patient.user.full_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={formData.type}
                      onValueChange={(value) => handleSelectChange('type', value)}
                    >
                      <SelectTrigger id="type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="intake">Intake</SelectItem>
                        <SelectItem value="output">Output</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => handleSelectChange('category', value)}
                    >
                      <SelectTrigger id="category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {getCategoryOptions().map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {formData.category && getRouteOptions().length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="route">Route/Type</Label>
                      <Select
                        value={formData.route}
                        onValueChange={(value) => handleSelectChange('route', value)}
                      >
                        <SelectTrigger id="route">
                          <SelectValue placeholder="Select route" />
                        </SelectTrigger>
                        <SelectContent>
                          {getRouteOptions().map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount (ml)</Label>
                    <Input
                      id="amount"
                      name="amount"
                      type="number"
                      placeholder="Enter amount in ml"
                      value={formData.amount}
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
                
                <Button type="submit" className="w-full">Record Fluid</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="today" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Today's Fluid Balance</CardTitle>
              <CardDescription>
                Summary of fluid intake and output for today
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 border rounded-md bg-blue-50">
                  <div className="flex items-center mb-2">
                    <ArrowDownCircle className="h-5 w-5 text-blue-500 mr-2" />
                    <h3 className="text-lg font-medium">Total Intake</h3>
                  </div>
                  <p className="text-3xl font-bold text-blue-600">{todayTotals.intake} ml</p>
                </div>
                
                <div className="p-4 border rounded-md bg-amber-50">
                  <div className="flex items-center mb-2">
                    <ArrowUpCircle className="h-5 w-5 text-amber-500 mr-2" />
                    <h3 className="text-lg font-medium">Total Output</h3>
                  </div>
                  <p className="text-3xl font-bold text-amber-600">{todayTotals.output} ml</p>
                </div>
                
                <div className={`p-4 border rounded-md ${
                  todayTotals.balance > 0 ? 'bg-green-50' : 
                  todayTotals.balance < 0 ? 'bg-red-50' : 'bg-gray-50'
                }`}>
                  <div className="flex items-center mb-2">
                    <Droplet className={`h-5 w-5 mr-2 ${
                      todayTotals.balance > 0 ? 'text-green-500' : 
                      todayTotals.balance < 0 ? 'text-red-500' : 'text-gray-500'
                    }`} />
                    <h3 className="text-lg font-medium">Balance</h3>
                  </div>
                  <p className={`text-3xl font-bold ${
                    todayTotals.balance > 0 ? 'text-green-600' : 
                    todayTotals.balance < 0 ? 'text-red-600' : 'text-gray-600'
                  }`}>
                    {todayTotals.balance > 0 ? '+' : ''}{todayTotals.balance} ml
                  </p>
                </div>
              </div>
              
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Today's Records</h3>
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Route/Type</TableHead>
                        <TableHead>Amount (ml)</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {getTodayRecords().map(record => (
                        <TableRow key={record.id}>
                          <TableCell>{format(new Date(record.timestamp), 'h:mm a')}</TableCell>
                          <TableCell className="capitalize">{record.type}</TableCell>
                          <TableCell>{record.category}</TableCell>
                          <TableCell>{record.route}</TableCell>
                          <TableCell className={record.type === 'intake' ? 'text-blue-600 font-medium' : 'text-amber-600 font-medium'}>
                            {record.amount}
                          </TableCell>
                          <TableCell>{record.notes}</TableCell>
                        </TableRow>
                      ))}
                      
                      {getTodayRecords().length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-4">
                            No records for today
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Fluid Balance History</CardTitle>
              <CardDescription>
                Complete history of fluid balance records
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Route/Type</TableHead>
                      <TableHead>Amount (ml)</TableHead>
                      <TableHead>Recorded By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fluidRecords.map(record => (
                      <TableRow key={record.id}>
                        <TableCell>{formatTimestamp(record.timestamp)}</TableCell>
                        <TableCell className="capitalize">{record.type}</TableCell>
                        <TableCell>{record.category}</TableCell>
                        <TableCell>{record.route}</TableCell>
                        <TableCell className={record.type === 'intake' ? 'text-blue-600 font-medium' : 'text-amber-600 font-medium'}>
                          {record.amount}
                        </TableCell>
                        <TableCell>{record.recorded_by}</TableCell>
                        <TableCell>{record.notes}</TableCell>
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
              <CardTitle>Fluid Balance Trends</CardTitle>
              <CardDescription>
                Visualize trends in fluid balance over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-medium mb-2">Daily Intake and Output</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={prepareChartData()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="intake" name="Intake (ml)" fill="#3b82f6" />
                      <Bar dataKey="output" name="Output (ml)" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-2">Daily Fluid Balance</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={prepareChartData()}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <ReferenceLine y={0} stroke="#000" />
                      <Bar dataKey="balance" name="Balance (ml)" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Daily Summaries</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Intake (ml)</TableHead>
                        <TableHead>Output (ml)</TableHead>
                        <TableHead>Balance (ml)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailySummaries.map(summary => (
                        <TableRow key={summary.date}>
                          <TableCell>{formatDate(summary.date)}</TableCell>
                          <TableCell className="text-blue-600 font-medium">{summary.intake}</TableCell>
                          <TableCell className="text-amber-600 font-medium">{summary.output}</TableCell>
                          <TableCell className={
                            summary.balance > 0 ? 'text-green-600 font-medium' : 
                            summary.balance < 0 ? 'text-red-600 font-medium' : ''
                          }>
                            {summary.balance > 0 ? '+' : ''}{summary.balance}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}