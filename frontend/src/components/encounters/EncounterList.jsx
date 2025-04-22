import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DatePicker } from '@/components/ui/date-picker';
import { format, parseISO, isValid } from 'date-fns';
import { useEncounters } from '@/hooks/useEncounterQueries';
import { PlusCircle, Search, Filter, Clock, Calendar, User, Building2, Activity } from 'lucide-react';

export function EncounterList() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');

  // Filter state
  const [filters, setFilters] = useState({
    patient: '',
    practitioner: '',
    date: null,
    status: 'all',
    type: 'all'
  });

  // Build query parameters based on active tab and filters
  const queryParams = {};

  if (activeTab === 'inpatient') {
    queryParams.encounter_type = 'inpatient';
  } else if (activeTab === 'outpatient') {
    queryParams.encounter_type = 'outpatient';
  } else if (activeTab === 'emergency') {
    queryParams.encounter_type = 'emergency';
  }

  if (filters.patient) {
    queryParams.patient_id = filters.patient;
  }

  if (filters.practitioner) {
    queryParams.practitioner_id = filters.practitioner;
  }

  if (filters.date) {
    queryParams.date = format(filters.date, 'yyyy-MM-dd');
  }

  if (filters.status && filters.status !== 'all') {
    queryParams.status = filters.status;
  }

  if (filters.type && filters.type !== 'all' && activeTab === 'all') {
    queryParams.encounter_type = filters.type;
  }

  // Use React Query to fetch encounters
  const { 
    data: encountersData, 
    isLoading, 
    isError, 
    error 
  } = useEncounters(queryParams);

  // Handle filter changes
  const handleFilterChange = (name, value) => {
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  // Reset filters
  const resetFilters = () => {
    setFilters({
      patient: '',
      practitioner: '',
      date: null,
      status: 'all',
      type: 'all'
    });
  };

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';

    try {
      const date = parseISO(dateString);
      return isValid(date) ? format(date, 'MMM d, yyyy h:mm a') : 'Invalid date';
    } catch (error) {
      return 'Invalid date';
    }
  };

  // Get status badge variant
  const getStatusBadge = (status) => {
    switch (status) {
      case 'planned':
        return <Badge variant="outline">Planned</Badge>;
      case 'in-progress':
        return <Badge variant="secondary">In Progress</Badge>;
      case 'finished':
        return <Badge variant="success">Finished</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Get encounter type badge
  const getTypeBadge = (type) => {
    switch (type) {
      case 'inpatient':
        return <Badge variant="default">Inpatient</Badge>;
      case 'outpatient':
        return <Badge variant="outline">Outpatient</Badge>;
      case 'emergency':
        return <Badge variant="destructive">Emergency</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  // Prepare encounters data
  const encounters = encountersData?.results || encountersData || [];

  // Handle error state
  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error?.message || 'Failed to load encounters. Please try again.'}</p>
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
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Encounters</h1>
        <Button onClick={() => navigate('/encounters/new')}>
          <PlusCircle className="h-4 w-4 mr-2" />
          New Encounter
        </Button>
      </div>

      <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
        <div className="flex justify-between items-center mb-4">
          <TabsList>
            <TabsTrigger value="all">All Encounters</TabsTrigger>
            <TabsTrigger value="inpatient">Inpatient</TabsTrigger>
            <TabsTrigger value="outpatient">Outpatient</TabsTrigger>
            <TabsTrigger value="emergency">Emergency</TabsTrigger>
          </TabsList>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Filter encounters by various criteria</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label htmlFor="patient">Patient</Label>
                <div className="flex">
                  <Input
                    id="patient"
                    placeholder="Patient ID"
                    value={filters.patient}
                    onChange={(e) => handleFilterChange('patient', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="practitioner">Practitioner</Label>
                <div className="flex">
                  <Input
                    id="practitioner"
                    placeholder="Practitioner ID"
                    value={filters.practitioner}
                    onChange={(e) => handleFilterChange('practitioner', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <DatePicker
                  date={filters.date}
                  setDate={(date) => handleFilterChange('date', date)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={filters.status}
                  onValueChange={(value) => handleFilterChange('status', value)}
                >
                  <SelectTrigger id="status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="finished">Finished</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {activeTab === 'all' && (
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={filters.type}
                    onValueChange={(value) => handleFilterChange('type', value)}
                  >
                    <SelectTrigger id="type">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="inpatient">Inpatient</SelectItem>
                      <SelectItem value="outpatient">Outpatient</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={resetFilters} className="mr-2">
                Reset Filters
              </Button>
              <Button>
                <Filter className="h-4 w-4 mr-2" />
                Apply Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        <TabsContent value="all" className="mt-6">
          <EncounterTable 
            encounters={encounters} 
            loading={isLoading} 
            formatDate={formatDate}
            getStatusBadge={getStatusBadge}
            getTypeBadge={getTypeBadge}
            navigate={navigate}
          />
        </TabsContent>

        <TabsContent value="inpatient" className="mt-6">
          <EncounterTable 
            encounters={encounters} 
            loading={isLoading} 
            formatDate={formatDate}
            getStatusBadge={getStatusBadge}
            getTypeBadge={getTypeBadge}
            navigate={navigate}
          />
        </TabsContent>

        <TabsContent value="outpatient" className="mt-6">
          <EncounterTable 
            encounters={encounters} 
            loading={isLoading} 
            formatDate={formatDate}
            getStatusBadge={getStatusBadge}
            getTypeBadge={getTypeBadge}
            navigate={navigate}
          />
        </TabsContent>

        <TabsContent value="emergency" className="mt-6">
          <EncounterTable 
            encounters={encounters} 
            loading={isLoading} 
            formatDate={formatDate}
            getStatusBadge={getStatusBadge}
            getTypeBadge={getTypeBadge}
            navigate={navigate}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EncounterTable({ encounters, loading, formatDate, getStatusBadge, getTypeBadge, navigate }) {
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (encounters.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10">
          <p className="text-muted-foreground mb-4">No encounters found matching your criteria.</p>
          <Button variant="outline" onClick={() => navigate('/encounters/new')}>
            <PlusCircle className="h-4 w-4 mr-2" />
            Create New Encounter
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Start Time</TableHead>
              <TableHead>End Time</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Practitioner</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {encounters.map((encounter) => (
              <TableRow key={encounter.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center">
                    <User className="h-4 w-4 mr-2 text-muted-foreground" />
                    {encounter.patient_name || 'Unknown Patient'}
                  </div>
                </TableCell>
                <TableCell>{getTypeBadge(encounter.encounter_type)}</TableCell>
                <TableCell>{getStatusBadge(encounter.status)}</TableCell>
                <TableCell>
                  <div className="flex items-center">
                    <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                    {formatDate(encounter.start_time)}
                  </div>
                </TableCell>
                <TableCell>
                  {encounter.end_time ? (
                    <div className="flex items-center">
                      <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                      {formatDate(encounter.end_time)}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Not ended</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center">
                    <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                    {encounter.location || 'N/A'}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center">
                    <Activity className="h-4 w-4 mr-2 text-muted-foreground" />
                    {encounter.practitioner_name || 'Unknown Practitioner'}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => navigate(`/encounters/${encounter.id}`)}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
