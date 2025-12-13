import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, startOfDay, endOfDay, addDays, subDays, isToday as checkIsToday } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Droplet, ArrowDownCircle, ArrowUpCircle, AlertCircle, Loader2, ChevronLeft, ChevronRight, CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useFluidBalance,
  useTodayFluidBalance,
  useFluidBalanceSummary,
  useCreateFluidBalance,
} from '@/hooks/useNursingQueries';

export function FluidBalanceTracker({ patient, admission }) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const isToday = checkIsToday(selectedDate);
  const formattedDate = format(selectedDate, 'yyyy-MM-dd');

  const [formData, setFormData] = useState({
    type: 'intake',
    category: '',
    subcategory: '',
    amount: '',
    colour: '',
    notes: ''
  });

  // Fetch fluid balance data from API (all records for history/trends)
  const {
    data: fluidRecords = [],
    isLoading: recordsLoading,
    error: recordsError,
    refetch: refetchRecords
  } = useFluidBalance(patient?.id);

  // Fetch selected date's summary from API
  const {
    data: dateSummary,
    isLoading: summaryLoading,
  } = useFluidBalanceSummary(patient?.id, formattedDate);

  // For backwards compatibility, also fetch today's summary
  const {
    data: todaySummary,
  } = useTodayFluidBalance(patient?.id);

  // Mutation for creating new entries
  const createMutation = useCreateFluidBalance();

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle select changes
  const handleSelectChange = (name, value) => {
    if (name === 'type') {
      // Reset category and subcategory when type changes
      setFormData(prev => ({
        ...prev,
        [name]: value,
        category: '',
        subcategory: ''
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  // Category options based on entry type (matching backend choices)
  const getCategoryOptions = () => {
    if (formData.type === 'intake') {
      return [
        { label: 'Oral', value: 'oral' },
        { label: 'IV Fluids', value: 'iv' },
        { label: 'Enteral Feed', value: 'enteral' },
        { label: 'Blood Products', value: 'blood' }
      ];
    } else {
      return [
        { label: 'Urine', value: 'urine' },
        { label: 'Vomit', value: 'vomit' },
        { label: 'Stool', value: 'stool' },
        { label: 'Drain', value: 'drain' },
        { label: 'N.G. Suction', value: 'ng_suction' },
        { label: 'Other', value: 'other' }
      ];
    }
  };

  // Subcategory options based on selected category
  const getSubcategoryOptions = () => {
    if (!formData.category) return [];

    const subcategoryMap = {
      'oral': [
        { label: 'Water', value: 'Water' },
        { label: 'Juice', value: 'Juice' },
        { label: 'Tea', value: 'Tea' },
        { label: 'Coffee', value: 'Coffee' },
        { label: 'Milk', value: 'Milk' },
        { label: 'Other', value: 'Other' }
      ],
      'iv': [
        { label: 'Normal Saline', value: 'Normal Saline' },
        { label: 'Lactated Ringers', value: 'Lactated Ringers' },
        { label: 'D5W', value: 'D5W' },
        { label: 'Other', value: 'Other' }
      ],
      'enteral': [
        { label: 'Nasogastric', value: 'Nasogastric' },
        { label: 'PEG Tube', value: 'PEG Tube' },
        { label: 'Other', value: 'Other' }
      ],
      'blood': [
        { label: 'Packed RBCs', value: 'Packed RBCs' },
        { label: 'Platelets', value: 'Platelets' },
        { label: 'Plasma', value: 'Plasma' },
        { label: 'Other', value: 'Other' }
      ],
      'drain': [
        { label: 'Chest Tube', value: 'Chest Tube' },
        { label: 'Surgical Drain', value: 'Surgical Drain' },
        { label: 'JP Drain', value: 'JP Drain' },
        { label: 'Nasogastric Tube', value: 'Nasogastric Tube' },
        { label: 'Other', value: 'Other' }
      ],
      'urine': [
        { label: 'Voided', value: 'Voided' },
        { label: 'Foley Catheter', value: 'Foley Catheter' },
      ],
      'ng_suction': [
        { label: 'Aspirate', value: 'Aspirate' },
        { label: 'Drainage', value: 'Drainage' },
        { label: 'Other', value: 'Other' }
      ]
    };

    return subcategoryMap[formData.category] || [];
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate amount
    const amount = parseInt(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount greater than 0');
      return;
    }

    if (!formData.category) {
      toast.error('Please select a category');
      return;
    }

    try {
      await createMutation.mutateAsync({
        patient: patient.id,
        admission: admission?.id || null,
        entry_type: formData.type,
        category: formData.category,
        subcategory: formData.subcategory || null,
        volume_ml: amount,
        colour: formData.type === 'output' && formData.colour ? formData.colour : null,
        notes: formData.notes || null,
      });

      toast.success('Fluid balance entry recorded successfully');

      // Reset form
      setFormData({
        type: 'intake',
        category: '',
        subcategory: '',
        amount: '',
        colour: '',
        notes: ''
      });
    } catch (err) {
      console.error('Error recording fluid balance:', err);
      toast.error('Failed to record fluid balance. Please try again.');
    }
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  // Get today's records
  const getTodayRecords = () => {
    const today = new Date();
    const startOfToday = startOfDay(today);
    const endOfToday = endOfDay(today);

    // Handle both array and paginated responses
    const records = Array.isArray(fluidRecords) ? fluidRecords : (fluidRecords?.results || []);

    return records.filter(record => {
      const recordDate = new Date(record.recorded_at);
      return recordDate >= startOfToday && recordDate <= endOfToday;
    });
  };

  // Calculate daily summaries from records
  const calculateDailySummaries = () => {
    const records = Array.isArray(fluidRecords) ? fluidRecords : (fluidRecords?.results || []);
    const summaries = {};

    records.forEach(record => {
      const date = format(new Date(record.recorded_at), 'yyyy-MM-dd');

      if (!summaries[date]) {
        summaries[date] = {
          date,
          intake: 0,
          output: 0,
          balance: 0
        };
      }

      if (record.entry_type === 'intake') {
        summaries[date].intake += record.volume_ml;
      } else {
        summaries[date].output += record.volume_ml;
      }

      summaries[date].balance = summaries[date].intake - summaries[date].output;
    });

    return Object.values(summaries).sort((a, b) => new Date(b.date) - new Date(a.date));
  };

  // Prepare chart data
  const prepareChartData = () => {
    const summaries = calculateDailySummaries();
    return summaries.map(summary => ({
      date: format(new Date(summary.date), 'MMM d'),
      intake: summary.intake,
      output: summary.output,
      balance: summary.balance
    })).reverse();
  };

  // Get display label for category
  const getCategoryLabel = (category) => {
    const labels = {
      oral: 'Oral',
      iv: 'IV Fluids',
      enteral: 'Enteral Feed',
      blood: 'Blood Products',
      urine: 'Urine',
      vomit: 'Vomit',
      stool: 'Stool',
      drain: 'Drain',
      ng_suction: 'N.G. Suction',
      other: 'Other'
    };
    return labels[category] || category;
  };

  // Date navigation helpers
  const goToPreviousDay = () => setSelectedDate(prev => subDays(prev, 1));
  const goToNextDay = () => setSelectedDate(prev => addDays(prev, 1));
  const goToToday = () => setSelectedDate(new Date());

  // Get records for selected date
  const getSelectedDateRecords = () => {
    const startOfSelected = startOfDay(selectedDate);
    const endOfSelected = endOfDay(selectedDate);
    const records = Array.isArray(fluidRecords) ? fluidRecords : (fluidRecords?.results || []);
    return records.filter(record => {
      const recordDate = new Date(record.recorded_at);
      return recordDate >= startOfSelected && recordDate <= endOfSelected;
    });
  };

  // Loading state
  if (recordsLoading && !fluidRecords.length) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Error state
  if (recordsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load fluid balance records. Please try again.
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => refetchRecords()}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Use selected date's summary, fallback to today's summary for backwards compat
  const displaySummary = dateSummary || todaySummary || { total_intake: 0, total_output: 0, balance: 0 };
  const records = Array.isArray(fluidRecords) ? fluidRecords : (fluidRecords?.results || []);

  return (
    <div className="space-y-6">
      {/* Date Navigation Bar */}
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPreviousDay}
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "min-w-[200px] justify-start text-left font-normal",
                  !selectedDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                disabled={(date) => date > new Date()}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="icon"
            onClick={goToNextDay}
            disabled={isToday}
            title="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {!isToday && (
            <Button variant="secondary" size="sm" onClick={goToToday}>
              Today
            </Button>
          )}
        </div>

        {isToday && (
          <span className="text-sm text-muted-foreground bg-green-100 text-green-700 px-2 py-1 rounded">
            Viewing Today
          </span>
        )}
      </div>

      <Tabs defaultValue="record">
        <TabsList>
          <TabsTrigger value="record">Record Fluid</TabsTrigger>
          <TabsTrigger value="today">{isToday ? "Today's Balance" : format(selectedDate, 'MMM d') + ' Balance'}</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="record" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Record Fluid Balance</CardTitle>
              <CardDescription>
                Enter fluid intake or output for {patient?.user?.full_name || patient?.patient_name || 'this patient'}
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

                  {formData.category && getSubcategoryOptions().length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="subcategory">Subcategory</Label>
                      <Select
                        value={formData.subcategory}
                        onValueChange={(value) => handleSelectChange('subcategory', value)}
                      >
                        <SelectTrigger id="subcategory">
                          <SelectValue placeholder="Select subcategory (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {getSubcategoryOptions().map(option => (
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
                      min="1"
                      max="10000"
                      required
                    />
                  </div>

                  {/* Colour field for output entries */}
                  {formData.type === 'output' && (
                    <div className="space-y-2">
                      <Label htmlFor="colour">Colour</Label>
                      <Input
                        id="colour"
                        name="colour"
                        placeholder="e.g., dark amber, clear, bloody"
                        value={formData.colour}
                        onChange={handleInputChange}
                      />
                    </div>
                  )}
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

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Recording...
                    </>
                  ) : (
                    'Record Fluid'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="today" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{isToday ? "Today's" : format(selectedDate, 'MMM d, yyyy')} Fluid Balance</CardTitle>
              <CardDescription>
                Summary of fluid intake and output for {isToday ? 'today' : format(selectedDate, 'MMMM d, yyyy')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 border rounded-md bg-blue-50">
                    <div className="flex items-center mb-2">
                      <ArrowDownCircle className="h-5 w-5 text-blue-500 mr-2" />
                      <h3 className="text-lg font-medium">Total Intake</h3>
                    </div>
                    <p className="text-3xl font-bold text-blue-600">{displaySummary.total_intake} ml</p>
                  </div>

                  <div className="p-4 border rounded-md bg-amber-50">
                    <div className="flex items-center mb-2">
                      <ArrowUpCircle className="h-5 w-5 text-amber-500 mr-2" />
                      <h3 className="text-lg font-medium">Total Output</h3>
                    </div>
                    <p className="text-3xl font-bold text-amber-600">{displaySummary.total_output} ml</p>
                  </div>

                  <div className={`p-4 border rounded-md ${
                    displaySummary.balance > 0 ? 'bg-green-50' :
                    displaySummary.balance < 0 ? 'bg-red-50' : 'bg-gray-50'
                  }`}>
                    <div className="flex items-center mb-2">
                      <Droplet className={`h-5 w-5 mr-2 ${
                        displaySummary.balance > 0 ? 'text-green-500' :
                        displaySummary.balance < 0 ? 'text-red-500' : 'text-gray-500'
                      }`} />
                      <h3 className="text-lg font-medium">Balance</h3>
                    </div>
                    <p className={`text-3xl font-bold ${
                      displaySummary.balance > 0 ? 'text-green-600' :
                      displaySummary.balance < 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {displaySummary.balance > 0 ? '+' : ''}{displaySummary.balance} ml
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-lg font-medium">{isToday ? "Today's" : format(selectedDate, 'MMM d')} Records</h3>
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Subcategory</TableHead>
                        <TableHead>Amount (ml)</TableHead>
                        <TableHead>Colour</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {getSelectedDateRecords().map(record => (
                        <TableRow key={record.id}>
                          <TableCell>{format(new Date(record.recorded_at), 'h:mm a')}</TableCell>
                          <TableCell className="capitalize">{record.entry_type}</TableCell>
                          <TableCell>{getCategoryLabel(record.category)}</TableCell>
                          <TableCell>{record.subcategory || '-'}</TableCell>
                          <TableCell className={record.entry_type === 'intake' ? 'text-blue-600 font-medium' : 'text-amber-600 font-medium'}>
                            {record.volume_ml}
                          </TableCell>
                          <TableCell>{record.entry_type === 'output' && record.colour ? record.colour : '-'}</TableCell>
                          <TableCell>{record.notes || '-'}</TableCell>
                        </TableRow>
                      ))}

                      {getSelectedDateRecords().length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-4 text-muted-foreground">
                            No records for {isToday ? 'today' : format(selectedDate, 'MMMM d, yyyy')}
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
                      <TableHead>Subcategory</TableHead>
                      <TableHead>Amount (ml)</TableHead>
                      <TableHead>Colour</TableHead>
                      <TableHead>Recorded By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map(record => (
                      <TableRow key={record.id}>
                        <TableCell>{formatTimestamp(record.recorded_at)}</TableCell>
                        <TableCell className="capitalize">{record.entry_type}</TableCell>
                        <TableCell>{getCategoryLabel(record.category)}</TableCell>
                        <TableCell>{record.subcategory || '-'}</TableCell>
                        <TableCell className={record.entry_type === 'intake' ? 'text-blue-600 font-medium' : 'text-amber-600 font-medium'}>
                          {record.volume_ml}
                        </TableCell>
                        <TableCell>{record.entry_type === 'output' && record.colour ? record.colour : '-'}</TableCell>
                        <TableCell>{record.recorded_by_name || '-'}</TableCell>
                        <TableCell>{record.notes || '-'}</TableCell>
                      </TableRow>
                    ))}

                    {records.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-4 text-muted-foreground">
                          No fluid balance records found
                        </TableCell>
                      </TableRow>
                    )}
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
                      {calculateDailySummaries().map(summary => (
                        <TableRow key={summary.date}>
                          <TableCell>{format(new Date(summary.date), 'MMM d, yyyy')}</TableCell>
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

                      {calculateDailySummaries().length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                            No data available for trends
                          </TableCell>
                        </TableRow>
                      )}
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
