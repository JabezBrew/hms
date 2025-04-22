import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useWard, useWardBeds, useAdmissions } from '@/hooks/useWardQueries';
import { WardBedLayout } from './WardBedLayout';
import { WardOccupancyStats } from './WardOccupancyStats';
import { WardFilterBar } from './WardFilterBar';

export function WardDashboard() {
  const { wardId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    bedType: '',
    searchTerm: '',
  });

  // Use React Query hooks for fetching data
  const { 
    data: ward, 
    isLoading: isWardLoading, 
    isError: isWardError,
    error: wardError
  } = useWard(wardId);

  const { 
    data: beds = [], 
    isLoading: isBedsLoading, 
    isError: isBedsError,
    error: bedsError
  } = useWardBeds(wardId);

  const { 
    data: admissions = [], 
    isLoading: isAdmissionsLoading, 
    isError: isAdmissionsError,
    error: admissionsError
  } = useAdmissions({ ward: wardId });

  // Determine overall loading and error states
  const loading = isWardLoading || isBedsLoading || isAdmissionsLoading;

  // Set error state if any query fails
  useEffect(() => {
    if (isWardError) {
      setError(wardError?.message || 'Failed to load ward details');
      console.error('Error loading ward:', wardError);
    } else if (isBedsError) {
      setError(bedsError?.message || 'Failed to load beds');
      console.error('Error loading beds:', bedsError);
    } else if (isAdmissionsError) {
      setError(admissionsError?.message || 'Failed to load admissions');
      console.error('Error loading admissions:', admissionsError);
    } else {
      setError(null);
    }
  }, [isWardError, wardError, isBedsError, bedsError, isAdmissionsError, admissionsError]);

  // Filter beds based on filters
  const filteredBeds = beds.filter(bed => {
    // Filter by status
    if (filters.status && filters.status !== 'all' && bed.status !== filters.status) {
      return false;
    }

    // Filter by bed type
    if (filters.bedType && filters.bedType !== 'all' && bed.bed_type !== filters.bedType) {
      return false;
    }

    // Filter by search term (bed number)
    if (filters.searchTerm && !bed.bed_number.toLowerCase().includes(filters.searchTerm.toLowerCase())) {
      return false;
    }

    return true;
  });

  // Handle filter changes
  const handleFilterChange = (newFilters) => {
    setFilters({ ...filters, ...newFilters });
  };

  // Handle bed click
  const handleBedClick = (bedId) => {
    // Find if there's an active admission for this bed
    const activeAdmission = admissions.find(
      admission => admission.bed.id === bedId && admission.status === 'admitted'
    );

    if (activeAdmission) {
      // Navigate to admission details
      navigate(`/admissions/${activeAdmission.id}`);
    } else {
      // Navigate to bed details
      navigate(`/beds/${bedId}`);
    }
  };

  // Handle new admission
  const handleNewAdmission = () => {
    navigate('/admissions/new', { state: { wardId } });
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
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

  if (!ward) {
    return (
      <Card className="m-4">
        <CardHeader>
          <CardTitle>Ward Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p>The requested ward could not be found.</p>
          <Button 
            variant="outline" 
            className="mt-4"
            onClick={() => navigate('/wards')}
          >
            Back to Wards
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">{ward.name}</h1>
          <p className="text-muted-foreground">{ward.description}</p>
        </div>
        <Button onClick={handleNewAdmission}>New Admission</Button>
      </div>

      <WardOccupancyStats 
        totalBeds={ward.total_beds} 
        availableBeds={ward.available_beds_count} 
        occupancyRate={ward.occupancy_rate} 
      />

      <WardFilterBar 
        filters={filters} 
        onFilterChange={handleFilterChange} 
      />

      <div className="mt-4">
        <WardBedLayout 
          beds={filteredBeds} 
          admissions={admissions} 
          onBedClick={handleBedClick}
          wardId={ward.id}
        />
      </div>
    </div>
  );
}
