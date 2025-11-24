import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { usePatient } from '@/hooks/usePatientQueries';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Edit2 } from 'lucide-react';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { TimelineFeed } from '@/components/patient/TimelineFeed';

// Mock Feed Data
const mockFeedItems = [
  {
    id: '1',
    date: 'Today, 9:00 AM',
    type: 'Encounter',
    title: 'Office Visit - Hypertension',
    summary: 'Patient reports dizziness. BP 150/90. Adjusted Lisinopril dosage.',
    author: 'Dr. Smith'
  },
  {
    id: '2',
    date: 'Yesterday, 2:30 PM',
    type: 'LabResult',
    title: 'CBC, BMP',
    summary: 'Potassium elevated (5.8). Creatinine 1.2.',
    author: 'Lab Corp'
  },
  {
    id: '3',
    date: 'Oct 15, 2023',
    type: 'Document',
    title: 'Cardiology Consult',
    summary: 'Dr. Jones recommends continued monitoring. No intervention needed at this time.',
    author: 'Dr. Jones'
  },
  {
    id: '4',
    date: 'Oct 10, 2023',
    type: 'Medication',
    title: 'Refill Request - Lisinopril',
    summary: '90 day supply approved.',
    author: 'Dr. Smith'
  }
]

const PatientDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: patient, isLoading, isError, error } = usePatient(id);
  const { updateBreadcrumbs } = useBreadcrumb();

  // Update breadcrumbs when data is loaded
  useEffect(() => {
    if (patient) {
      // Extract patient name from nested structure
      const firstName = patient.local_data?.user_details?.first_name || '';
      const lastName = patient.local_data?.user_details?.last_name || '';
      const patientName = firstName && lastName ? `${firstName} ${lastName}` : `Patient ${id}`;

      updateBreadcrumbs([
        { label: 'Patients', path: '/patients' },
        {
          label: patientName,
          path: `/patients/${id}`
        }
      ]);
    }
  }, [patient, id, updateBreadcrumbs]);

  const handleAction = (action) => {
    switch (action) {
      case 'note':
        // Navigate to create note (mock)
        toast.info("Starting new clinical note...");
        break;
      case 'prescribe':
        toast.info("Opening ePrescribe...");
        break;
      case 'message':
        toast.info("Opening secure message...");
        break;
    }
  }

  if (isLoading) {
    return <div className="p-6 space-y-4">
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4 space-y-4">
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="col-span-8 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  }

  if (isError) {
    return <div className="p-6 text-red-500">Error loading patient: {error?.message}</div>
  }

  // Extract patient name for display
  const firstName = patient?.local_data?.user_details?.first_name || '';
  const lastName = patient?.local_data?.user_details?.last_name || '';
  const patientName = firstName && lastName ? `${firstName} ${lastName}` : 'Patient';

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{patientName} | HMS</title>
      </Helmet>

      <PatientHeader patient={patient} onAction={handleAction} />

      <div className="container mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* Left Panel: Static Snapshot (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base font-semibold">Active Problems</CardTitle>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Plus className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="py-2">
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center justify-between group">
                    <span>Hypertension (I10)</span>
                    <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 cursor-pointer text-muted-foreground" />
                  </li>
                  <li className="flex items-center justify-between group">
                    <span>Type 2 Diabetes (E11.9)</span>
                    <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 cursor-pointer text-muted-foreground" />
                  </li>
                  <li className="flex items-center justify-between group">
                    <span>Osteoarthritis (M19.9)</span>
                    <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 cursor-pointer text-muted-foreground" />
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-base font-semibold">Current Meds</CardTitle>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Plus className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="py-2">
                <ul className="space-y-3 text-sm">
                  <li className="flex flex-col">
                    <div className="flex justify-between font-medium">
                      <span>Lisinopril 10mg</span>
                      <span className="text-muted-foreground">Daily</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Last filled: Oct 10</span>
                  </li>
                  <li className="flex flex-col">
                    <div className="flex justify-between font-medium">
                      <span>Metformin 500mg</span>
                      <span className="text-muted-foreground">BID</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Last filled: Sep 25</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base font-semibold">Vitals Trends</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Blood Pressure</span>
                      <span className="font-medium">138/88</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-500 w-[70%]" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Weight</span>
                      <span className="font-medium">185 lbs</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 w-[60%]" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel: Chronological Feed (8 cols) */}
          <div className="lg:col-span-8">
            <TimelineFeed items={mockFeedItems} />
          </div>

        </div>
      </div>
    </div>
  );
};

export default PatientDetailPage;
