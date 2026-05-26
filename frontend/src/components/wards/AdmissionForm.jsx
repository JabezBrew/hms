import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeApiResults } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { SearchBar } from '@/components/ui/search-bar';
import { BedAssignment } from './BedAssignment';
import { admissionsApi } from '@/features/admissions/api';
import { admissionCaseKeys } from '@/features/admissions/hooks/useAdmissionCaseQueries';
import { wardKeys } from '@/features/wards/hooks/useWardQueries';
import format from 'date-fns/format';
import { useDebounce } from '@/hooks/use-debounce';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function AdmissionForm({ wardId = null, wardData = null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [patients, setPatients] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [selectedBed, setSelectedBed] = useState(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');

  // Search state
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const debouncedPatientQuery = useDebounce(patientSearchQuery, 300);

  const [practitionerSearchQuery, setPractitionerSearchQuery] = useState("");
  const [isLoadingPractitioners, setIsLoadingPractitioners] = useState(false);
  const debouncedPractitionerQuery = useDebounce(practitionerSearchQuery, 300);

  const [formData, setFormData] = useState({
    patient: '',
    admitting_doctor: '',
    admission_type: 'elective',
    admission_date: new Date(),
    expected_discharge_date: null,
    admission_notes: '',
  });

  // Search for patients when query changes
  useEffect(() => {
    const searchForPatients = async () => {
      if (!debouncedPatientQuery || debouncedPatientQuery.length < 2) {
        setPatients([]);
        return;
      }

      setIsLoadingPatients(true);
      try {
        const response = await admissionsApi.searchPatients(debouncedPatientQuery);
        setPatients(normalizeApiResults(response));
      } catch (err) {
        console.error('Error searching patients:', err);
        setError('Failed to search patients');
        setPatients([]);
      } finally {
        setIsLoadingPatients(false);
      }
    };

    searchForPatients();
  }, [debouncedPatientQuery]);

  // Search for practitioners when query changes
  useEffect(() => {
    const searchForPractitioners = async () => {
      if (!debouncedPractitionerQuery || debouncedPractitionerQuery.length < 2) {
        setPractitioners([]);
        return;
      }

      setIsLoadingPractitioners(true);
      try {
        // Using doctorsOnly=true since admissions are typically handled by doctors
        const results = await admissionsApi.searchPractitioners(debouncedPractitionerQuery, true);
        setPractitioners(Array.isArray(results) ? results : []);
      } catch (err) {
        console.error('Error searching practitioners:', err);
        setError('Failed to search practitioners');
        setPractitioners([]);
      } finally {
        setIsLoadingPractitioners(false);
      }
    };

    searchForPractitioners();
  }, [debouncedPractitionerQuery]);

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

  // Format patient options for SearchBar
  const patientOptions = Array.isArray(patients) ? patients.flatMap(patient => {
    let name = "Unknown Patient";
    let id = "";

    // Use the local database ID, not the FHIR ID
    // The backend expects the PatientProfile ID
    if (patient?.id) {
      id = patient.id;
    } else if (patient?.local_data?.id) {
      id = patient.local_data.id;
    }

    // Check for simple name field first (from search API)
    if (patient?.name) {
      name = patient.name;
    }
    // Get the display name from FHIR resource if available
    else if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.join(' ') || "";
      const family = patient.fhir_resource.name[0].family || "";
      name = `${family}, ${given}`.trim() || "Unknown Patient";
    }
    // Then check for local_data
    else if (patient?.local_data?.user_details) {
      name = `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || "Unknown Patient";
    }
    // Fallback to old format
    else if (patient?.user?.full_name) {
      name = patient.user.full_name;
    }

    // Only return options with valid IDs (check for null, undefined, empty string, or 0)
    return (id && id !== '' && id !== 0) ? [{
      label: name,
      value: id
    }] : [];
  }) : []; // Filter out null values

  // Format practitioner options for SearchBar
  const practitionerOptions = Array.isArray(practitioners) ? practitioners.flatMap(practitioner => {
    let displayName = 'Unknown Practitioner';
    let id = null;

    // Get the local database ID from the correct location
    if (practitioner?.local_data?.id) {
      id = practitioner.local_data.id;
    } else if (practitioner?.id) {
      id = practitioner.id;
    }

    // Skip if no valid ID (check for null, undefined, empty string, or 0)
    if (!id || id === '' || id === 0) return [];

    // Get display name from various possible structures
    if (practitioner.fhir_resource?.name?.[0]) {
      // New structure with FHIR resource
      const name = practitioner.fhir_resource.name[0];
      const given = name?.given?.join(' ') || '';
      const family = name?.family || '';
      const specialization = practitioner.local_data?.specialization || 'Doctor';
      displayName = `${given} ${family} - ${specialization}`.trim();
    } else if (practitioner.local_data?.staff_details) {
      // Structure with local_data.staff_details
      const firstName = practitioner.local_data.staff_details?.user_details?.first_name || '';
      const lastName = practitioner.local_data.staff_details?.user_details?.last_name || '';
      const specialization = practitioner.local_data?.specialization || 'Doctor';
      displayName = `${firstName} ${lastName} - ${specialization}`.replace(/\s+/g, ' ').trim();
    } else if (practitioner.staff_details) {
      // Structure with staff_details at top level
      displayName = `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.specialization || 'Doctor'}`.replace(/\s+/g, ' ').trim();
    } else if (practitioner.user?.full_name) {
      // Fallback to old format
      displayName = `${practitioner.user.full_name} - ${practitioner.specialization || 'Doctor'}`;
    }

    return [{
      label: displayName,
      value: id
    }];
  }) : []; // Filter out null values

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        {error && (
          <Card className="border-red-500 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <svg className="size-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-red-800">Error creating admission</h3>
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="flex-shrink-0 text-red-500 hover:text-red-700"
                >
                  <span className="sr-only">Dismiss</span>
                  <svg className="size-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </CardContent>
          </Card>
        )}
        <Card className="border-border">
          <CardHeader className="pb-4">
            <CardTitle className="font-display text-xl">Patient Details</CardTitle>
            <CardDescription className="font-mono text-xs">
              Enter the details for patient admission
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Patient selection */}
            <div className="space-y-2">
              <Label htmlFor="patient" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Patient
              </Label>
              <SearchBar
                options={patientOptions}
                value={formData.patient}
                onChange={(value) => handleSelectChange('patient', value)}
                onInputChange={setPatientSearchQuery}
                placeholder="Search for a patient..."
                emptyMessage={isLoadingPatients ? "Searching..." : "No patients found."}
                searchPlaceholder="Search by name, MRN, or NHIS ID..."
                disabled={submitting}
                maxHeight="20rem"
                isLoading={isLoadingPatients}
              />
              <p className="text-xs text-muted-foreground">
                Search for a patient by name, medical record number (MRN), or NHIS ID.
              </p>
            </div>

            {/* Admission type */}
            <div className="space-y-2">
              <Label htmlFor="admission_type" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Admission Type
              </Label>
              <Select
                value={formData.admission_type}
                onValueChange={(value) => handleSelectChange('admission_type', value)}
              >
                <SelectTrigger id="admission_type">
                  <SelectValue placeholder="Select admission type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="emergency">Emergency</SelectItem>
                  <SelectItem value="elective">Elective</SelectItem>
                  <SelectItem value="maternity">Maternity</SelectItem>
                  <SelectItem value="newborn">Newborn</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Admitting doctor */}
            <div className="space-y-2">
              <Label htmlFor="admitting_doctor" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Admitting Doctor
              </Label>
              <SearchBar
                options={practitionerOptions}
                value={formData.admitting_doctor}
                onChange={(value) => handleSelectChange('admitting_doctor', value)}
                onInputChange={setPractitionerSearchQuery}
                placeholder="Search for a doctor..."
                emptyMessage={isLoadingPractitioners ? "Searching..." : "No doctors found."}
                searchPlaceholder="Search by name, employee ID, or license number..."
                disabled={submitting}
                maxHeight="20rem"
                isLoading={isLoadingPractitioners}
              />
              <p className="text-xs text-muted-foreground">
                Search for a doctor by name, employee ID, or license number.
              </p>
            </div>

            {/* Admission date */}
            <div className="space-y-2">
              <Label htmlFor="admission_date" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Admission Date
              </Label>
              <DatePicker
                date={formData.admission_date}
                setDate={(date) => handleDateChange('admission_date', date)}
                placeholder="Select admission date"
                className="font-mono text-sm"
              />
            </div>

            {/* Expected discharge date */}
            <div className="space-y-2">
              <Label htmlFor="expected_discharge_date" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Expected Discharge Date (Optional)
              </Label>
              <DatePicker
                date={formData.expected_discharge_date}
                setDate={(date) => handleDateChange('expected_discharge_date', date)}
                placeholder="Select discharge date"
                className="font-mono text-sm"
              />
            </div>

            {/* Admission notes */}
            <div className="space-y-2">
              <Label htmlFor="admission_notes" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Admission Notes
              </Label>
              <Textarea
                id="admission_notes"
                name="admission_notes"
                value={formData.admission_notes}
                onChange={handleInputChange}
                placeholder="Enter any notes about the admission..."
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        {/* Bed assignment */}
        <BedAssignment
          onBedSelect={handleBedSelect}
          selectedBedId={selectedBed?.id}
          wardId={wardId}
          wardData={wardData}
        />

        {/* Form actions */}
        <div className="flex justify-end gap-4">
          <Button 
            type="button" 
            variant="outline"
            onClick={() => navigate(-1)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            disabled={submitting || !formData.patient}
          >
            {submitting ? 'Submitting Admission...' : selectedBed ? 'Admit Patient' : 'Start Admission'}
          </Button>
        </div>
      </div>

      {/* Validation Dialog */}
      <AlertDialog open={showValidationDialog} onOpenChange={setShowValidationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Validation Error</AlertDialogTitle>
            <AlertDialogDescription>
              {validationMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
