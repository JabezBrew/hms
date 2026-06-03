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
  { value: 'ready_for_activation', label: 'Ready for activation' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'discharge_pending', label: 'Discharge pending' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'cancelled', label: 'Cancelled' },
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
