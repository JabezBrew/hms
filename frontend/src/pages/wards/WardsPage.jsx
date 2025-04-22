import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Plus, Hospital } from 'lucide-react';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';
import { useWards } from '@/hooks/useWardQueries';

export default function WardsPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Use React Query hook for fetching wards
  const { 
    data: wards = [], 
    isLoading: loading, 
    isError,
    error: queryError
  } = useWards();

  // Extract error message from query error
  const error = isError ? (queryError?.message || 'Failed to load wards. Please try again.') : null;

  // Define breadcrumbs for this page
  const breadcrumbs = [
    { label: 'Wards', path: '/wards' }
  ];

  // Check if user is admin
  useEffect(() => {
    const userJson = localStorage.getItem('user');
    if (userJson) {
      const user = JSON.parse(userJson);
      setIsAdmin(user.role === 'admin');
    }
  }, []);

  // Filter wards based on search term
  const filteredWards = wards.filter(ward => 
    ward.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ward.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ward.ward_type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle ward click
  const handleWardClick = (wardId) => {
    navigate(`/wards/${wardId}`);
  };

  // Handle new ward
  const handleNewWard = () => {
    // Since buttons are only visible to admins, we can simplify this function
    const userJson = localStorage.getItem('user');
    if (userJson) {
      navigate('/wards/new');
    } else {
      navigate('/login');
    }
  };

  // Get ward type display name
  const getWardTypeDisplay = (wardType) => {
    const wardTypes = {
      'general': 'General Ward',
      'private': 'Private Ward',
      'icu': 'Intensive Care Unit',
      'emergency': 'Emergency Ward',
      'maternity': 'Maternity Ward',
      'pediatric': 'Pediatric Ward',
      'psychiatric': 'Psychiatric Ward',
      'isolation': 'Isolation Ward',
    };
    return wardTypes[wardType] || wardType;
  };

  // Get occupancy status color
  const getOccupancyColor = (rate) => {
    if (rate < 70) return 'bg-green-100 text-green-800';
    if (rate < 90) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Wards</h1>
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-6">
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
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Set breadcrumb navigation */}
      <BreadcrumbSetter breadcrumbs={breadcrumbs} />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-3xl font-bold">Wards</h1>
        {isAdmin && (
          <Button onClick={handleNewWard}>
            <Plus className="h-4 w-4 mr-2" />
            New Ward
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search wards by name, type, or description..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredWards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-6">
            <Hospital className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No wards found</p>
            <p className="text-muted-foreground">
              {wards.length > 0 
                ? 'Try adjusting your search terms' 
                : isAdmin 
                  ? 'Create your first ward to get started'
                  : 'No wards available at this time'}
            </p>
            {wards.length === 0 && isAdmin && (
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={handleNewWard}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Ward
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredWards.map(ward => (
            <Card 
              key={ward.id} 
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleWardClick(ward.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle>{ward.name}</CardTitle>
                  <Badge variant={ward.is_active ? "outline" : "destructive"}>
                    {ward.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <CardDescription>{getWardTypeDisplay(ward.ward_type)}</CardDescription>
              </CardHeader>
              <CardContent className="pb-2">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {ward.description || 'No description available'}
                </p>
              </CardContent>
              <CardFooter className="flex justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Beds:</span>
                  <span className="text-sm">{ward.total_beds}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Occupancy:</span>
                  <Badge 
                    variant="outline" 
                    className={getOccupancyColor(ward.occupancy_rate)}
                  >
                    {ward.occupancy_rate.toFixed(1)}%
                  </Badge>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
