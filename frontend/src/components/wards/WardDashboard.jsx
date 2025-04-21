import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchWard, fetchBeds, fetchAdmissions } from '@/lib/api.js';
import { WardBedLayout } from './WardBedLayout';
import { WardOccupancyStats } from './WardOccupancyStats';
import { WardFilterBar } from './WardFilterBar';

export function WardDashboard() {
  const { wardId } = useParams();
  const navigate = useNavigate();
  const [ward, setWard] = useState(null);
  const [beds, setBeds] = useState([]);
  const [admissions, setAdmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    bedType: '',
    searchTerm: '',
  });

  // Fetch ward details
  useEffect(() => {
    const fetchWardDetails = async () => {
      try {
        setLoading(true);
        const wardData = await fetchWard(wardId);
        setWard(wardData);

        // Fetch beds in the ward
        const bedsData = await fetchBeds({ ward: wardId, page_size: 1000 });
        setBeds(bedsData);

        // Fetch admissions in the ward
        const admissionsData = await fetchAdmissions({ ward: wardId, page_size: 1000 });
        setAdmissions(admissionsData);

        setLoading(false);
      } catch (err) {
        console.error('Error fetching ward details:', err);
        setError('Failed to load ward details. Please try again.');
        setLoading(false);
      }
    };

    if (wardId) {
      fetchWardDetails();
    }
  }, [wardId]);

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
