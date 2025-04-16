import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import PatientForm from '@/components/patients/PatientForm';

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
    <div className="space-y-4">
      <div className="flex items-center">
        <button 
          className="text-sm text-muted-foreground hover:text-foreground flex items-center"
          onClick={() => navigate('/patients')}
        >
          ← Back to Patient List
        </button>
      </div>
      <div className="max-w-4xl mx-auto">
        <PatientForm 
          onSuccess={handleSuccess} 
        />
      </div>
    </div>
  );
};

export default PatientCreatePage;
