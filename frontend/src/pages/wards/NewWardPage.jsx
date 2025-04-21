import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createWard } from '@/lib/api.js';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';

export default function NewWardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    ward_type: 'general',
    description: '',
    total_beds: 0,
    base_rate_per_night: '',
    is_active: true
  });

  // Define breadcrumbs for this page
  const breadcrumbs = [
    { label: 'Wards', path: '/wards' },
    { label: 'New Ward', path: '/wards/new' }
  ];

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
    setLoading(true);
    setError(null);

    try {
      // Ensure total_beds and base_rate_per_night are numbers
      const wardData = {
        ...formData,
        total_beds: parseInt(formData.total_beds, 10),
        base_rate_per_night: parseFloat(formData.base_rate_per_night)
      };

      await createWard(wardData);
      navigate('/wards');
    } catch (err) {
      console.error('Error creating ward:', err);
      setError(err.message || 'Failed to create ward. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-6">
      {/* Set breadcrumb navigation */}
      <BreadcrumbSetter breadcrumbs={breadcrumbs} />

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Create New Ward</h1>
        <Button variant="outline" onClick={() => navigate('/wards')}>
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
              Enter the details for the new ward. All fields are required.
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
              onClick={() => navigate('/wards')}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Ward'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
