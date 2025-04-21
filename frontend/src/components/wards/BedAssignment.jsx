import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchBar } from '@/components/ui/search-bar';
import { fetchWards, fetchBeds } from '@/lib/api';

export function BedAssignment({ onBedSelect, selectedBedId = null, wardId = null }) {
  const [wards, setWards] = useState([]);
  const [beds, setBeds] = useState([]);
  const [selectedWard, setSelectedWard] = useState(wardId);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch wards with search functionality
  useEffect(() => {
    const fetchWardsData = async () => {
      try {
        setSearchLoading(true);
        const params = {};

        // Add search parameter if there's a search query
        if (searchQuery) {
          params.search = searchQuery;
        }

        const data = await fetchWards(params);
        // Ensure data is an array
        const wardsArray = Array.isArray(data) ? data : [];
        setWards(wardsArray);

        // If no ward is selected and we have wards, select the first one
        if (!selectedWard && wardsArray.length > 0 && !searchQuery) {
          setSelectedWard(wardsArray[0].id);
        }

        setLoading(false);
        setSearchLoading(false);
      } catch (err) {
        console.error('Error fetching wards:', err);
        setError('Failed to load wards. Please try again.');
        setLoading(false);
        setSearchLoading(false);
      }
    };

    fetchWardsData();
  }, [searchQuery, selectedWard]);

  // Fetch beds when ward changes
  useEffect(() => {
    const fetchBedsForWard = async () => {
      if (!selectedWard) return;

      try {
        setLoading(true);
        const data = await fetchBeds({ ward: selectedWard, page_size: 'all' });  // Add page_size=all
        setBeds(data);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching beds:', err);
        setError('Failed to load beds');
        setLoading(false);
      }
    };

    fetchBedsForWard();
  }, [selectedWard]);

  // Get ward options for search bar
  const wardOptions = Array.isArray(wards) ? wards.map(ward => ({
    label: `${ward.name} (${ward.available_beds_count} available) - ${ward.get_ward_type_display || ward.ward_type}`,
    value: ward.id
  })) : [];

  // Handle ward change
  const handleWardChange = (wardId) => {
    setSelectedWard(wardId);
  };

  // Handle search input change
  const handleSearchInputChange = (value) => {
    setSearchQuery(value);
  };

  // Get status color for a bed
  const getStatusColor = (status) => {
    switch (status) {
      case 'available':
        return 'bg-green-100 border-green-500 text-green-700';
      case 'occupied':
        return 'bg-red-100 border-red-500 text-red-700';
      case 'reserved':
        return 'bg-yellow-100 border-yellow-500 text-yellow-700';
      case 'maintenance':
        return 'bg-gray-100 border-gray-500 text-gray-700';
      case 'cleaning':
        return 'bg-blue-100 border-blue-500 text-blue-700';
      default:
        return 'bg-gray-100 border-gray-500 text-gray-700';
    }
  };

  // Filter available beds
  const availableBeds = beds.filter(bed => bed.status === 'available');

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
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
    <Card>
      <CardHeader>
        <CardTitle>Assign Bed</CardTitle>
        <CardDescription>Select a ward and then choose an available bed</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ward selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Search for a Ward</label>
          <SearchBar
            options={wardOptions}
            value={selectedWard}
            onChange={handleWardChange}
            onInputChange={handleSearchInputChange}
            placeholder="Search for a ward by name, type, or description..."
            emptyMessage="No wards found. Try a different search term."
            isLoading={searchLoading}
          />
        </div>

        {/* Bed selection */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium">Select Bed</label>
            <Badge variant="outline">
              {availableBeds.length} available beds
            </Badge>
          </div>

          <div className="mt-4">
              {availableBeds.length === 0 ? (
                <div className="text-center p-4 border rounded-md">
                  <p className="text-muted-foreground">No available beds in this ward</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                  {availableBeds.map(bed => (
                    <div 
                      key={bed.id} 
                      className={`h-24 border-2 rounded-md p-2 flex flex-col justify-between cursor-pointer hover:shadow-md transition-shadow ${getStatusColor(bed.status)} ${selectedBedId === bed.id ? 'ring-2 ring-primary' : ''}`}
                      onClick={() => onBedSelect(bed)}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-bold">{bed.bed_number}</span>
                        <Badge variant="outline" className="text-xs">
                          {bed.get_bed_type_display}
                        </Badge>
                      </div>
                      <div className="text-xs">
                        ${bed.total_rate}/night
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedBedId ? 'Bed selected' : 'No bed selected'}
        </div>
      </CardFooter>
    </Card>
  );
}
