import Search from 'lucide-react/dist/esm/icons/search.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { PatientList } from './PatientList';
import { MedicationAdministration } from './MedicationAdministration';
import { useWards, useAdmissions } from '@/features/wards/hooks/useWardQueries';
import { toast } from 'sonner';

// Lazy load chart-heavy components to reduce initial bundle size (~180KB saved)
const VitalSignsRecorder = lazy(() => import('./VitalSignsRecorder').then(m => ({ default: m.VitalSignsRecorder })));
const FluidBalanceTracker = lazy(() => import('./FluidBalanceTracker').then(m => ({ default: m.FluidBalanceTracker })));

// Loading fallback for lazy-loaded chart components
const ChartLoadingFallback = () => (
  <div className="space-y-4 p-4">
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-64 w-full" />
    <Skeleton className="h-32 w-full" />
  </div>
);

export function NursingDashboard() {
  const [selectedWard, setSelectedWard] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [activeTab, setActiveTab] = useState('patients');

  // Use React Query to fetch wards
  const { 
    data: wardsData, 
    isLoading: isWardsLoading, 
    isError: isWardsError,
    error: wardsError
  } = useWards();

  useEffect(() => {
    if (wardsData && wardsData.length > 0 && !selectedWard) {
      setSelectedWard(wardsData[0].id);
    }
  }, [wardsData, selectedWard]);

  useEffect(() => {
    if (isWardsError) {
      toast.error(wardsError?.message || 'Failed to load wards. Please try again.');
    }
  }, [isWardsError, wardsError]);

  // Use React Query to fetch admissions for the selected ward
  const {
    data: admissionsData,
    isLoading: isAdmissionsLoading,
    isError: isAdmissionsError,
    error: admissionsError
  } = useAdmissions(
    { ward: selectedWard, status: 'admitted', page_size: 200 },
    { enabled: !!selectedWard }
  );

  useEffect(() => {
    if (isAdmissionsError) {
      toast.error(admissionsError?.message || 'Failed to load patients. Please try again.');
    }
  }, [isAdmissionsError, admissionsError]);

  const patients = useMemo(() => {
    if (!admissionsData) return [];
    return admissionsData.reduce((acc, admission) => {
      if (admission?.patient) {
        acc.push({
          ...admission.patient,
          admission,
          bed: admission.bed,
        });
      }
      return acc;
    }, []);
  }, [admissionsData]);

  const filteredPatients = useMemo(() => {
    const query = searchTerm.toLowerCase();
    return patients.filter((patient) => {
      const name = patient?.user?.full_name?.toLowerCase() || '';
      const bedNumber = patient?.bed?.bed_number?.toLowerCase() || '';
      return name.includes(query) || bedNumber.includes(query);
    });
  }, [patients, searchTerm]);

  // Handle ward change
  const handleWardChange = (wardId) => {
    setSelectedWard(wardId);
    setSelectedPatient(null);
  };

  // Handle patient selection
  const handlePatientSelect = (patient) => {
    setSelectedPatient(patient);
    setActiveTab('vitals');
  };

  // Handle tab change
  const handleTabChange = (value) => {
    setActiveTab(value);
  };

  // Show loading state if either wards or admissions are loading
  if ((isWardsLoading || (isAdmissionsLoading && selectedWard)) && !selectedPatient) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Show error state if either wards or admissions have an error
  if ((isWardsError || isAdmissionsError) && !selectedPatient) {
    return (
      <Card className="m-4">
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{isWardsError 
            ? (wardsError?.message || 'Failed to load wards. Please try again.') 
            : (admissionsError?.message || 'Failed to load patients. Please try again.')}
          </p>
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
    <div className="space-y-6 p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold">Nursing Care Dashboard</h1>

        {/* Ward selector */}
        <div className="w-full md:w-64">
          <Select
            value={selectedWard}
            onValueChange={handleWardChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select ward" />
            </SelectTrigger>
            <SelectContent>
              {wardsData && wardsData.map(ward => (
                <SelectItem key={ward.id} value={ward.id}>
                  {ward.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedPatient ? (
        <div className="space-y-6">
          {/* Patient header */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>{selectedPatient.user.full_name}</CardTitle>
                  <CardDescription>
                    {selectedPatient.bed.ward.name} - Bed {selectedPatient.bed.bed_number}
                  </CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedPatient(null)}
                >
                  Back to Patient List
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Patient care tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid grid-cols-3">
              <TabsTrigger value="vitals">
                <Activity className="size-4 mr-2" />
                Vital Signs
              </TabsTrigger>
              <TabsTrigger value="medications">
                <Pill className="size-4 mr-2" />
                Medications
              </TabsTrigger>
              <TabsTrigger value="fluids">
                <Droplet className="size-4 mr-2" />
                Fluid Balance
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vitals" className="mt-4">
              <Suspense fallback={<ChartLoadingFallback />}>
                <VitalSignsRecorder patient={selectedPatient} />
              </Suspense>
            </TabsContent>

            <TabsContent value="medications" className="mt-4">
              <MedicationAdministration patient={selectedPatient} />
            </TabsContent>

            <TabsContent value="fluids" className="mt-4">
              <Suspense fallback={<ChartLoadingFallback />}>
                <FluidBalanceTracker patient={selectedPatient} />
              </Suspense>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
            <Input
              placeholder="Search patients by name or bed number..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Patient list */}
          <PatientList 
            patients={filteredPatients} 
            onPatientSelect={handlePatientSelect} 
          />
        </div>
      )}
    </div>
  );
}
