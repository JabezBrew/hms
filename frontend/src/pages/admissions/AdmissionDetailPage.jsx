import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { DischargeForm } from '@/components/wards/DischargeForm';
import { apiClient } from '@/lib/api';
import format from 'date-fns/format';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export default function AdmissionDetailPage() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const [admission, setAdmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDischargeForm, setShowDischargeForm] = useState(false);

  // Fetch admission details
  useEffect(() => {
    const fetchAdmissionDetails = async () => {
      try {
        setLoading(true);
        const data = await apiClient.get(`/admissions/${admissionId}/`);
        setAdmission(data);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching admission details:', err);
        setError('Failed to load admission details. Please try again.');
        setLoading(false);
      }
    };

    if (admissionId) {
      fetchAdmissionDetails();
    }
  }, [admissionId]);

  // Handle discharge completion
  const handleDischargeComplete = () => {
    // Refresh admission data
    const fetchAdmissionDetails = async () => {
      try {
        const data = await apiClient.get(`/admissions/${admissionId}/`);
        setAdmission(data);
        setShowDischargeForm(false);
      } catch (err) {
        console.error('Error fetching admission details:', err);
      }
    };

    fetchAdmissionDetails();
  };

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return format(new Date(dateString), 'PPP');
  };

  // Get status badge variant
  const getStatusBadge = (status) => {
    switch (status) {
      case 'admitted':
        return <Badge className="bg-green-100 text-green-800">Admitted</Badge>;
      case 'discharged':
        return <Badge className="bg-blue-100 text-blue-800">Discharged</Badge>;
      case 'transferred':
        return <Badge className="bg-yellow-100 text-yellow-800">Transferred</Badge>;
      case 'deceased':
        return <Badge className="bg-red-100 text-red-800">Deceased</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
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

  if (!admission) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardHeader>
            <CardTitle>Admission Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <p>The requested admission could not be found.</p>
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
    <div className="container mx-auto py-6 space-y-6">
      {/* Breadcrumb navigation */}
      <Breadcrumb>
        <BreadcrumbItem>
          <BreadcrumbLink as={Link} to="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink as={Link} to="/wards">Wards</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink as={Link} to={`/wards/${admission.bed.ward.id}`}>
            {admission.bed.ward.name}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink>Admission</BreadcrumbLink>
        </BreadcrumbItem>
      </Breadcrumb>

      {/* Action buttons */}
      <div className="flex justify-between items-center">
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate(`/wards/${admission.bed.ward.id}`)}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Ward
        </Button>
        
        {admission.status === 'admitted' && (
          <Button 
            size="sm"
            onClick={() => setShowDischargeForm(true)}
          >
            Discharge Patient
          </Button>
        )}
      </div>

      {/* Admission header */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">
                {admission.patient.user.full_name}
              </CardTitle>
              <CardDescription>
                Patient ID: {admission.patient.id}
              </CardDescription>
            </div>
            {getStatusBadge(admission.status)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Admission Date</h3>
              <p>{formatDate(admission.admission_date)}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Expected Discharge</h3>
              <p>{formatDate(admission.expected_discharge_date)}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Actual Discharge</h3>
              <p>{formatDate(admission.actual_discharge_date)}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Admission Type</h3>
              <p className="capitalize">{admission.admission_type.replace('_', ' ')}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Ward & Bed</h3>
              <p>{admission.bed.ward.name} - Bed {admission.bed.bed_number}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Daily Rate</h3>
              <p>${admission.daily_rate}/night</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Length of Stay</h3>
              <p>{admission.length_of_stay} days</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Total Cost</h3>
              <p>${admission.total_cost}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Admitting Doctor</h3>
              <p>{admission.admitting_doctor?.user.full_name || 'Not assigned'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Discharge form or tabs */}
      {showDischargeForm ? (
        <DischargeForm 
          admission={admission} 
          onDischargeComplete={handleDischargeComplete} 
        />
      ) : (
        <Tabs defaultValue="notes">
          <TabsList>
            <TabsTrigger value="notes">
              <Clipboard className="h-4 w-4 mr-2" />
              Notes
            </TabsTrigger>
            <TabsTrigger value="vitals">
              <FileText className="h-4 w-4 mr-2" />
              Vital Signs
            </TabsTrigger>
            <TabsTrigger value="billing">
              <DollarSign className="h-4 w-4 mr-2" />
              Billing
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="notes" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Admission Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {admission.admission_notes ? (
                  <div className="whitespace-pre-wrap">{admission.admission_notes}</div>
                ) : (
                  <p className="text-muted-foreground">No admission notes available.</p>
                )}
              </CardContent>
            </Card>
            
            {admission.discharge_notes && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Discharge Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-wrap">{admission.discharge_notes}</div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          <TabsContent value="vitals" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Vital Signs</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">No vital signs recorded for this admission.</p>
                
                <div className="mt-4">
                  <Button variant="outline">
                    <FileText className="h-4 w-4 mr-2" />
                    Record Vital Signs
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="billing" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Billing Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Daily Rate</h3>
                      <p className="text-lg font-medium">${admission.daily_rate}/night</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Length of Stay</h3>
                      <p className="text-lg font-medium">{admission.length_of_stay} days</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Total Room Cost</h3>
                      <p className="text-lg font-medium">${admission.total_cost}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground">Billing Status</h3>
                      <p className="text-lg font-medium">
                        {admission.is_billed ? 'Billed' : 'Not Billed'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t">
                    <h3 className="text-sm font-medium mb-2">Actions</h3>
                    <div className="flex gap-2">
                      <Button variant="outline">
                        <DollarSign className="h-4 w-4 mr-2" />
                        Generate Invoice
                      </Button>
                      <Button variant="outline">
                        <FileText className="h-4 w-4 mr-2" />
                        View Invoices
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}