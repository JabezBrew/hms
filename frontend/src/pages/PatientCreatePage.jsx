import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ChevronLeft, UserPlus } from 'lucide-react';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';
import PatientForm from '@/components/patients/PatientForm';

/**
 * PatientCreatePage - Chronicle-style patient registration page
 *
 * Features:
 * - Editorial header with icon and typography
 * - Multi-step tabbed form
 * - FHIR-compliant patient registration
 */
const PatientCreatePage = () => {
  const navigate = useNavigate();

  // Function to get patient ID from different possible structures
  const getPatientId = (patient) => {
    if (patient?.local_data?.id) {
      return patient.local_data.id;
    } else if (patient?.fhir_data?.id) {
      return patient.fhir_data.id;
    } else if (patient?.fhir_resource?.id) {
      return patient.fhir_resource.id;
    } else if (patient?.id) {
      return patient.id;
    }
    return null;
  };

  const handleSuccess = (newPatient) => {
    toast.success('Patient created successfully');
    // Navigate to the new patient's detail page
    const patientId = getPatientId(newPatient);
    if (patientId) {
      navigate(`/patients/${patientId}`);
    } else {
      // If we don't have an ID, go back to the patient list
      console.error('No patient ID found in the response:', newPatient);
      navigate('/patients');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <BreadcrumbSetter
        breadcrumbs={[
          { label: 'Patients', path: '/patients' },
          { label: 'Register New Patient' }
        ]}
      />

      {/* Page Header */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Back Navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/patients')}
            className="mb-4 -ml-2 font-mono text-xs"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Patient Registry
          </Button>

          {/* Title Section */}
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="font-display text-3xl md:text-4xl text-foreground tracking-tight">
                Register New Patient
              </h1>
              <p className="text-muted-foreground mt-1 font-mono text-sm">
                Enter patient demographics, medical information, and contact details
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <PatientForm onSuccess={handleSuccess} />
      </div>
    </div>
  );
};

export default PatientCreatePage;
