/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeApiResults } from '@/lib/utils';
import { BedAssignment } from './BedAssignment';
import {
  AdmissionDateSection,
  AdmissionDetailsCard,
  AdmissionDoctorSection,
  AdmissionErrorCard,
  AdmissionFormActions,
  AdmissionNotesSection,
  AdmissionPatientSection,
  AdmissionTypeSection,
  AdmissionValidationDialog,
} from './AdmissionFormSections';
import {
  buildAdmissionPatientOptions,
  buildAdmissionPractitionerOptions,
} from './AdmissionFormOptions';
import { admissionsApi } from '@/features/admissions/api';
import { admissionCaseKeys } from '@/features/admissions/hooks/useAdmissionCaseQueries';
import { wardKeys } from '@/features/wards/hooks/useWardQueries';
import format from 'date-fns/format';
import { useDebounce } from '@/hooks/use-debounce';

export function AdmissionForm({ wardId = null, wardData = null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [selectedBed, setSelectedBed] = useState(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');

  // Search state
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const debouncedPatientQuery = useDebounce(patientSearchQuery, 300);
  const patientSearchEnabled = debouncedPatientQuery.length >= 2;
  const {
    data: patientSearchResults = [],
    isFetching: isLoadingPatients,
    isError: isPatientSearchError,
  } = useQuery({
    queryKey: ['admissions', 'patient-search', debouncedPatientQuery],
    queryFn: ({ signal }) => admissionsApi.searchPatients(debouncedPatientQuery, { signal }),
    enabled: patientSearchEnabled,
    staleTime: 60 * 1000,
  });
  const patients = useMemo(
    () => patientSearchEnabled ? normalizeApiResults(patientSearchResults) : [],
    [patientSearchEnabled, patientSearchResults]
  );

  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState("");
  const debouncedPractitionerQuery = useDebounce(practitionerSearchQuery, 300);
  const practitionerSearchEnabled = debouncedPractitionerQuery.length >= 2;
  const {
    data: practitionerSearchResults = [],
    isFetching: isLoadingPractitioners,
    isError: isPractitionerSearchError,
  } = useQuery({
    queryKey: ['admissions', 'practitioner-search', { query: debouncedPractitionerQuery, doctorsOnly: true }],
    queryFn: ({ signal }) => admissionsApi.searchPractitioners(debouncedPractitionerQuery, true, { signal }),
    enabled: practitionerSearchEnabled,
    staleTime: 5 * 60 * 1000,
  });
  const practitioners = useMemo(
    () => practitionerSearchEnabled && Array.isArray(practitionerSearchResults)
      ? practitionerSearchResults
      : [],
    [practitionerSearchEnabled, practitionerSearchResults]
  );

  const [formData, setFormData] = useState({
    patient: '',
    admitting_doctor: '',
    admission_type: 'elective',
    admission_date: new Date(),
    expected_discharge_date: null,
    admission_notes: '',
  });

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle select changes
  const handleSelectChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle date changes
  const handleDateChange = (name, date) => {
    setFormData(prev => ({ ...prev, [name]: date }));
  };

  // Handle bed selection
  const handleBedSelect = (bed) => {
    setSelectedBed(bed);
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.patient) {
      setValidationMessage('Please select a patient.');
      setShowValidationDialog(true);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Format dates for API
      const formattedData = {
        patient: formData.patient,
        // Send full datetime with current time to preserve the actual admission time
        admission_date: formData.admission_date.toISOString(),
        expected_discharge_date: formData.expected_discharge_date
          ? format(formData.expected_discharge_date, 'yyyy-MM-dd')
          : null,
        admission_type: formData.admission_type,
        admission_notes: formData.admission_notes || '',
      };

      const selectedBedWardId = selectedBed?.ward_id
        || selectedBed?.ward
        || selectedBed?.ward_details?.id
        || selectedBed?.wardDetails?.id
        || wardId;

      if (selectedBed?.id) {
        formattedData.bed = selectedBed.id;
        if (selectedBedWardId) {
          formattedData.requested_ward = selectedBedWardId;
        }
      } else if (wardId) {
        formattedData.requested_ward = wardId;
      }

      // Only include admitting_doctor if it's set
      if (formData.admitting_doctor) {
        formattedData.admitting_doctor = formData.admitting_doctor;
      }

      // Create admission using the dedicated API function
      const response = await admissionsApi.createAdmission(formattedData);

      // Invalidate all ward-related queries to refresh data
      queryClient.invalidateQueries({ queryKey: wardKeys.all });
      queryClient.invalidateQueries({ queryKey: wardKeys.beds() });
      queryClient.invalidateQueries({ queryKey: wardKeys.admissions() });
      queryClient.invalidateQueries({ queryKey: admissionCaseKeys.all });

      if (response?.activated === false && response?.admission_case_id) {
        navigate(`/admissions/cases/${response.admission_case_id}`);
      } else if (response?.id) {
        navigate(`/admissions/${response.id}`);
      } else if (response?.admission_case_id) {
        navigate(`/admissions/cases/${response.admission_case_id}`);
      } else if (wardId) {
        navigate(`/wards/${wardId}`);
      }
    } catch (err) {
      // Use the error message from the API client (which now includes field errors)
      const errorMessage = err.message || 'Failed to create admission. Please try again.';

      setError(errorMessage);
      setSubmitting(false);
    }
  };

  const patientOptions = buildAdmissionPatientOptions(patients);
  const practitionerOptions = buildAdmissionPractitionerOptions(practitioners);

  const patientEmptyMessage = isLoadingPatients
    ? "Searching..."
    : isPatientSearchError
      ? "Failed to search patients."
      : "No patients found.";
  const practitionerEmptyMessage = isLoadingPractitioners
    ? "Searching..."
    : isPractitionerSearchError
      ? "Failed to search doctors."
      : "No doctors found.";

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        <AdmissionErrorCard error={error} onDismiss={() => setError(null)} />

        <AdmissionDetailsCard>
          <AdmissionPatientSection
            options={patientOptions}
            value={formData.patient}
            onChange={(value) => handleSelectChange('patient', value)}
            onInputChange={setPatientSearchQuery}
            emptyMessage={patientEmptyMessage}
            disabled={submitting}
            isLoading={isLoadingPatients}
          />
          <AdmissionTypeSection
            value={formData.admission_type}
            onChange={(value) => handleSelectChange('admission_type', value)}
          />
          <AdmissionDoctorSection
            options={practitionerOptions}
            value={formData.admitting_doctor}
            onChange={(value) => handleSelectChange('admitting_doctor', value)}
            onInputChange={setPractitionerSearchQuery}
            emptyMessage={practitionerEmptyMessage}
            disabled={submitting}
            isLoading={isLoadingPractitioners}
          />
          <AdmissionDateSection
            admissionDate={formData.admission_date}
            expectedDischargeDate={formData.expected_discharge_date}
            onAdmissionDateChange={(date) => handleDateChange('admission_date', date)}
            onExpectedDischargeDateChange={(date) => handleDateChange('expected_discharge_date', date)}
          />
          <AdmissionNotesSection
            value={formData.admission_notes}
            onChange={handleInputChange}
          />
        </AdmissionDetailsCard>

        <BedAssignment
          onBedSelect={handleBedSelect}
          selectedBedId={selectedBed?.id}
          wardId={wardId}
          wardData={wardData}
        />

        <AdmissionFormActions
          submitting={submitting}
          canSubmit={Boolean(formData.patient)}
          selectedBed={selectedBed}
          onCancel={() => navigate(-1)}
        />
      </div>

      <AdmissionValidationDialog
        open={showValidationDialog}
        onOpenChange={setShowValidationDialog}
        message={validationMessage}
      />
    </form>
  );
}
