export const CLINICAL_PROVIDER_ROLES = [
  'doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
  'inpatient_doctor',
  'practitioner',
  'physician',
  'lab_technician',
  'pharmacist',
];

export const ADMISSION_STATUS_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'transferred', label: 'Transferred' },
  { value: 'deceased', label: 'Deceased' },
];

export const ADMISSION_TYPE_OPTIONS = [
  { value: 'all', label: 'Any admission type' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'elective', label: 'Elective' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'newborn', label: 'Newborn' },
];

export const ENCOUNTER_TYPE_OPTIONS = [
  { value: 'all', label: 'Any encounter type' },
  { value: 'inpatient', label: 'Inpatient' },
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'emergency', label: 'Emergency' },
];

export const DEFAULT_SEARCH_ORDERING = '-created_at';
export const SEARCH_TABLE_PAGE_SIZE = 25;
export const DEFAULT_REGISTRY_SCOPE = 'active';

export const REGISTRY_SCOPE_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'deceased', label: 'Deceased' },
  { value: 'all', label: 'All Registered' },
];

export const REGISTRY_SCOPE_LABELS = {
  active: 'Active patients',
  discharged: 'Discharged patients',
  deceased: 'Deceased patients',
  all: 'All registered patients',
};

export const TABLE_COLUMNS = [
  { key: 'created_at', label: 'Registered' },
  { key: 'medical_record_number', label: 'MRN' },
  { key: 'name', label: 'Name' },
  { key: 'date_of_birth', label: 'DOB / Age' },
  { key: 'gender', label: 'Sex' },
  { key: 'patient_location', label: 'Patient Location', sortable: false },
  { key: 'registry_status', label: 'Status' },
];
