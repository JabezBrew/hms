import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchBar } from '@/components/ui/search-bar';
import { BedAssignment } from './BedAssignment';
import { searchPatientsForAdmission, searchPractitionersForAdmission, createAdmission } from '@/lib/api.js';
import { format } from 'date-fns';
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

export function AdmissionForm({ wardId = null }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
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
        const response = await searchPatientsForAdmission(debouncedPatientQuery);
        const patientsData = response.patients || [];
        setPatients(Array.isArray(patientsData) ? patientsData : []);
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
        const results = await searchPractitionersForAdmission(debouncedPractitionerQuery, true);
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

    if (!selectedBed) {
      setValidationMessage('Please select a bed for the patient.');
      setShowValidationDialog(true);
      return;
    }

    if (!formData.patient) {
      setValidationMessage('Please select a patient.');
      setShowValidationDialog(true);
      return;
    }

    try {
      setSubmitting(true);

      // Format dates for API
      const formattedData = {
        ...formData,
        bed: selectedBed.id,
        admission_date: format(formData.admission_date, 'yyyy-MM-dd'),
        expected_discharge_date: formData.expected_discharge_date 
          ? format(formData.expected_discharge_date, 'yyyy-MM-dd')
          : null,
      };

      // Create admission using the dedicated API function
      const response = await createAdmission(formattedData);

      // Navigate to the new admission
      navigate(`/admissions/${response.id}`);
    } catch (err) {
      console.error('Error creating admission:', err);
      setError('Failed to create admission. Please try again.');
      setSubmitting(false);
    }
  };

  // Format patient options for SearchBar
  const patientOptions = Array.isArray(patients) ? patients.map(patient => {
    let name = "Unknown Patient";
    let id = "";

    // Check for FHIR resource format
    if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.join(' ') || "";
      const family = patient.fhir_resource.name[0].family || "";
      name = `${family}, ${given}`.trim() || "Unknown Patient";
      id = patient.fhir_resource.id;
    }
    // Then check for local_data
    else if (patient?.local_data?.user_details) {
      name = `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || "Unknown Patient";
      id = patient.local_data.id;
    }
    // Fallback to old format
    else if (patient?.user?.full_name) {
      name = patient.user.full_name;
      id = patient.id;
    }

    return {
      label: name,
      value: id
    };
  }) : [];

  // Format practitioner options for SearchBar
  const practitionerOptions = Array.isArray(practitioners) ? practitioners.map(practitioner => {
    // Handle both old and new response structures
    if (practitioner.fhir_resource) {
      // New structure with FHIR resource
      const name = practitioner.fhir_resource.name?.[0];
      const given = name?.given?.join(' ') || '';
      const family = name?.family || '';
      const displayName = `${family}, ${given}`.trim() || 'Unknown Practitioner';
      return {
        label: displayName,
        value: practitioner.fhir_resource.id
      };
    } else if (practitioner.staff_details) {
      // Structure with staff_details
      return {
        label: `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.specialization || 'Doctor'}`.replace(/\s+/g, ' ').trim(),
        value: practitioner.id
      };
    } else {
      // Fallback to old format
      return {
        label: `${practitioner.user?.full_name || 'Unknown'} - ${practitioner.specialization || 'Doctor'}`,
        value: practitioner.id
      };
    }
  }) : [];

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
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
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Patient Admission</CardTitle>
            <CardDescription>Enter the details for patient admission</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Patient selection */}
            <div className="space-y-2">
              <Label htmlFor="patient">Patient</Label>
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
              <Label htmlFor="admission_type">Admission Type</Label>
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
              <Label htmlFor="admitting_doctor">Admitting Doctor</Label>
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
              <Label htmlFor="admission_date">Admission Date</Label>
              <DatePicker
                date={formData.admission_date}
                setDate={(date) => handleDateChange('admission_date', date)}
              />
            </div>

            {/* Expected discharge date */}
            <div className="space-y-2">
              <Label htmlFor="expected_discharge_date">Expected Discharge Date (Optional)</Label>
              <DatePicker
                date={formData.expected_discharge_date}
                setDate={(date) => handleDateChange('expected_discharge_date', date)}
              />
            </div>

            {/* Admission notes */}
            <div className="space-y-2">
              <Label htmlFor="admission_notes">Admission Notes</Label>
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
            disabled={submitting || !selectedBed || !formData.patient}
          >
            {submitting ? 'Admitting Patient...' : 'Admit Patient'}
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
