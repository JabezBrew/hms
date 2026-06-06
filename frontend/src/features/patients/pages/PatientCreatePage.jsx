import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

import PatientForm from '@/components/patients/PatientForm';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

function getPatientId(patient) {
  if (patient?.local_data?.id) {
    return patient.local_data.id;
  }
  if (patient?.fhir_data?.id) {
    return patient.fhir_data.id;
  }
  if (patient?.fhir_resource?.id) {
    return patient.fhir_resource.id;
  }
  if (patient?.id) {
    return patient.id;
  }
  return null;
}

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

  const handleSuccess = (newPatient) => {
    toast.success('Patient registered successfully');
    const patientId = getPatientId(newPatient);

    if (patientId) {
      // Single URL - PatientPage component handles role-based view
      navigate(`/patients/${patientId}`);
    } else {
      navigate('/patients');
    }
  };

  const pageMeta = usePageMeta({
    title: 'Register Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Register New Patient' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-4xl mx-auto p-6">
          {/* Back Navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/patients')}
            className="mb-4 -ml-2 font-mono text-xs"
          >
            <ChevronLeft className="size-4 mr-1" />
            Back to Patient Directory
          </Button>

          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <UserPlus className="size-6 text-primary" />
            </div>
            <PageHeader
              title="Register New Patient"
              description="Capture patient identity, contact details, insurance, and encounter routing"
              size="md"
              wrap={false}
              className="border-none bg-transparent p-0"
              contentClassName="items-start"
              titleClassName="text-3xl md:text-4xl"
              descriptionClassName="mt-1 font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <PatientForm onSuccess={handleSuccess} />
      </div>
    </PageShell>
  );
};

export default PatientCreatePage;
