import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import { useCallback, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import format from 'date-fns/format';
import { admissionsApi } from '@/features/admissions/api';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

export default function AdmissionDetailPage() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const [admission, setAdmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadAdmission = useCallback(async () => {
    if (!admissionId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await admissionsApi.getAdmission(admissionId);
      setAdmission(data);
    } catch (err) {
      setError('Failed to load admission details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  // Fetch admission details
  useEffect(() => {
    loadAdmission();
  }, [loadAdmission]);

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

  const ward = admission?.bed?.ward;
  const patientName = admission?.patient?.user?.full_name;
  const backToWardPath = ward ? `/wards/${ward.id}` : '/wards';
  const backLabel = ward ? 'Back to Ward' : 'Back to Wards';
  const pageMeta = usePageMeta({
    title: patientName
      ? `${patientName} Admission | Hospital Management System`
      : 'Admission | Hospital Management System',
    breadcrumbs: [
      { label: 'Wards', path: '/wards' },
      ...(ward ? [{ label: ward.name, path: `/wards/${ward.id}` }] : []),
      { label: 'Admission', path: `/admissions/${admissionId}` },
    ],
  });

  if (loading) {
    return (
      <PageState variant="loading">
        {pageMeta}
      </PageState>
    );
  }

  if (error) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="error"
          title="Unable to load admission"
          description={error}
          action={() => loadAdmission()}
        />
      </>
    );
  }

  if (!admission) {
    return (
      <>
        {pageMeta}
        <PageState
          variant="empty"
          title="Admission not found"
          description="The requested admission could not be found."
          action={
            <Button variant="outline" onClick={() => navigate('/wards')}>
              Back to Wards
            </Button>
          }
        />
      </>
    );
  }

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={patientName || 'Admission'}
        description={admission?.patient?.id ? `Patient ID: ${admission.patient.id}` : undefined}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(backToWardPath)}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              {backLabel}
            </Button>
            {admission.status === 'admitted' && (
              <Button
                size="sm"
                disabled={!admission?.patient?.id}
                onClick={() => navigate(
                  `/patients/${admission.patient.id}?action=discharge&admission=${admission.id}&source=admission-detail`
                )}
              >
                Discharge Patient
              </Button>
            )}
          </div>
        )}
      >
        <div className="mt-2">
          {getStatusBadge(admission.status)}
        </div>
      </PageHeader>

      <main className="p-6 space-y-6">
      {/* Admission header */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">Admission Summary</CardTitle>
              <CardDescription>
                Key dates, ward assignment, and billing overview.
              </CardDescription>
            </div>
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

      {/* Clinical details */}
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
      </main>
    </PageShell>
  );
}
