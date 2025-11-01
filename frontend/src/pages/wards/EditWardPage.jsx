import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';
import { useWard, useUpdateWard } from '@/hooks/useWardQueries';
import { toast } from 'sonner';

export default function EditWardPage() {
  const { wardId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    ward_type: 'general',
    description: '',
    total_beds: 0,
    base_rate_per_night: '',
    is_active: true
  });

  // Fetch ward data
  const {
    data: ward,
    isLoading,
    isError,
    error: queryError
  } = useWard(wardId);

  // Update ward mutation
  const updateMutation = useUpdateWard();

  // Check if user is admin
  useEffect(() => {
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      navigate('/login');
      return;
    }

    const user = JSON.parse(userJson);
    if (user.role !== 'admin') {
      navigate('/wards');
      return;
    }
  }, [navigate]);

  // Populate form when ward data is loaded
  useEffect(() => {
    if (ward) {
      setFormData({
        name: ward.name || '',
        ward_type: ward.ward_type || 'general',
        description: ward.description || '',
        total_beds: ward.total_beds || 0,
        base_rate_per_night: ward.base_rate_per_night || '',
        is_active: ward.is_active !== undefined ? ward.is_active : true
      });
    }
  }, [ward]);

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(queryError?.message || 'Failed to load ward details');
      console.error('Error loading ward:', queryError);
    }
  }, [isError, queryError]);

  // Define breadcrumbs for this page
  const breadcrumbs = [
    { label: 'Wards', path: '/wards' },
    { label: ward?.name || 'Loading...', path: `/wards/${wardId}` },
    { label: 'Edit', path: `/wards/${wardId}/edit` }
  ];

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSelectChange = (name, value) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      // Ensure total_beds and base_rate_per_night are numbers
      const wardData = {
        ...formData,
        total_beds: parseInt(formData.total_beds, 10),
        base_rate_per_night: parseFloat(formData.base_rate_per_night)
      };

      updateMutation.mutate(
        { id: wardId, data: wardData },
        {
          onSuccess: () => {
            toast.success('Ward updated successfully');
            navigate(`/wards/${wardId}`);
          },
          onError: (err) => {
            console.error('Error updating ward:', err);
            setError(err.message || 'Failed to update ward. Please try again.');
            toast.error('Failed to update ward');
          }
        }
      );
    } catch (err) {
      console.error('Error updating ward:', err);
      setError(err.message || 'Failed to update ward. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <Skeleton className="h-8 w-64 mb-6" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-red-500">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{queryError?.message || 'Failed to load ward details. Please try again.'}</p>
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

  if (!ward) {
    return (
      <div className="container mx-auto py-6">
        <Card>
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
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      {/* Set breadcrumb navigation */}
      <BreadcrumbSetter breadcrumbs={breadcrumbs} />

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Edit Ward: {ward.name}</h1>
        <Button variant="outline" onClick={() => navigate(`/wards/${wardId}`)}>
          Cancel
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Ward Information</CardTitle>
            <CardDescription>
              Update the ward details below. All fields are required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Ward Name</Label>
                <Input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ward_type">Ward Type</Label>
                <Select
                  value={formData.ward_type}
                  onValueChange={(value) => handleSelectChange('ward_type', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select ward type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General Ward</SelectItem>
                    <SelectItem value="private">Private Ward</SelectItem>
                    <SelectItem value="icu">Intensive Care Unit</SelectItem>
                    <SelectItem value="emergency">Emergency Ward</SelectItem>
                    <SelectItem value="maternity">Maternity Ward</SelectItem>
                    <SelectItem value="pediatric">Pediatric Ward</SelectItem>
                    <SelectItem value="psychiatric">Psychiatric Ward</SelectItem>
                    <SelectItem value="isolation">Isolation Ward</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={4}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="total_beds">Total Beds</Label>
                <Input
                  id="total_beds"
                  name="total_beds"
                  type="number"
                  min="1"
                  value={formData.total_beds}
                  onChange={handleChange}
                  required
                />
                <p className="text-sm text-muted-foreground">
                  Note: Changing this will not automatically create or remove beds
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="base_rate_per_night">Base Rate Per Night ($)</Label>
                <Input
                  id="base_rate_per_night"
                  name="base_rate_per_night"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.base_rate_per_night}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                id="is_active"
                name="is_active"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                checked={formData.is_active}
                onChange={handleChange}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(`/wards/${wardId}`)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Updating...' : 'Update Ward'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
