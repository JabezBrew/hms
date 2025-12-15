import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { createWard } from '@/lib/api.js';
import { ChevronLeft, Building2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';

/**
 * NewWardPage - Chronicle-style ward creation page
 *
 * Features:
 * - Editorial header with icon and typography
 * - Clean form layout with Chronicle styling
 * - Admin-only access
 */
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
    { label: 'New Ward' }
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
    <div className="min-h-screen bg-background">
      <BreadcrumbSetter breadcrumbs={breadcrumbs} />

      {/* Page Header */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* Back Navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/wards')}
            className="mb-4 -ml-2 font-mono text-xs"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Wards
          </Button>

          {/* Title Section */}
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="font-display text-3xl md:text-4xl text-foreground tracking-tight">
                Create New Ward
              </h1>
              <p className="text-muted-foreground mt-1 font-mono text-sm">
                Configure ward details, capacity, and pricing
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card className="border-border">
          <form onSubmit={handleSubmit}>
            <CardContent className="pt-6 space-y-6">
              {/* Ward Name and Type */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label
                    htmlFor="name"
                    className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Ward Name
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="e.g., General Ward A"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="ward_type"
                    className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Ward Type
                  </Label>
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

              {/* Description */}
              <div className="space-y-2">
                <Label
                  htmlFor="description"
                  className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Description
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Brief description of the ward and its facilities..."
                  rows={3}
                />
              </div>

              {/* Capacity and Pricing */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label
                    htmlFor="total_beds"
                    className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Total Beds
                  </Label>
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
                  <Label
                    htmlFor="base_rate_per_night"
                    className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Base Rate Per Night ($)
                  </Label>
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

              {/* Active Status */}
              <div className="flex items-center space-x-3 pt-2">
                <Checkbox
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData(prev => ({ ...prev, is_active: checked }))
                  }
                />
                <Label
                  htmlFor="is_active"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Active
                </Label>
                <span className="text-xs text-muted-foreground">
                  (Ward will be available for admissions)
                </span>
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-3 pt-6 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/wards')}
                disabled={loading}
                className="font-mono text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="font-mono text-xs bg-primary hover:bg-primary/90"
              >
                {loading ? 'Creating...' : 'Create Ward'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
